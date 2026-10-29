"""v1.2.0 registration pipeline: status, reference numbers, the client named on
the /join page, and the client recorded at registration."""

from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from test_auth import auth_context  # noqa: F401
from test_domain_tables import make_customer, make_user
from test_join import REFERENCE, add_client, form, join  # noqa: F401
from test_phase4_api import add_scored_customer, api  # noqa: F401

from app.models import (
    AgentProfile,
    AuditLog,
    ClientProfile,
    Customer,
    Review,
    RiskAssessment,
    User,
)
from app.services import registration
from app.services.pipeline import registration_status, registration_status_sql
from app.services.reviews import apply_review

# (flagged, review decision) -> pipeline status; flagged None = not scored yet.
TRANSITIONS = [
    (None, None, "received"),
    (False, None, "clear"),
    (True, None, "under_review"),
    (True, "confirmed_real", "verified"),
    (True, "confirmed_fake", "rejected"),
]


@pytest.mark.parametrize(("flagged", "decision", "expected"), TRANSITIONS)
def test_registration_status_follows_score_and_review(flagged, decision, expected):
    assert registration_status(flagged, decision) == expected


def test_sql_status_matches_python_status(api):  # noqa: F811
    _, session, users, _ = api
    agent, admin = users["agent"], users["admin"]
    expected = {}
    for flagged, decision, status in TRANSITIONS:
        if flagged is None:
            customer = make_customer(session, agent, email=f"{uuid4()}@example.test")
        else:
            customer, assessment = add_scored_customer(session, agent, flagged)
            if decision:
                apply_review(session, None, admin, assessment, decision, None)
        expected[customer.id] = status
    session.commit()

    rows = session.execute(
        select(Customer.id, registration_status_sql())
        .outerjoin(RiskAssessment, RiskAssessment.customer_id == Customer.id)
        .outerjoin(Review, Review.assessment_id == RiskAssessment.id)
    ).all()
    assert dict(rows) == expected


def test_references_are_random_and_well_formed():
    references = {registration.new_reference() for _ in range(200)}
    assert len(references) == 200
    assert all(REFERENCE.match(reference) for reference in references)


def test_references_are_unique_in_the_database(db_session):
    agent = make_user(db_session)
    make_customer(db_session, agent, reference="SM-AAAA-BBBB")
    with pytest.raises(IntegrityError):
        make_customer(db_session, agent, reference="SM-AAAA-BBBB", email="b@x.test")


@pytest.mark.parametrize("reference", ["SM-AAAA-BBB", "SM-AAAA-BBBO", "AGT-AAAABBBB"])
def test_malformed_references_are_rejected(db_session, reference):
    with pytest.raises(IntegrityError):
        make_customer(db_session, make_user(db_session), reference=reference)


def test_reference_collision_is_retried(db_session, monkeypatch):
    make_customer(db_session, make_user(db_session), reference="SM-AAAA-BBBB")
    candidates = iter(["SM-AAAA-BBBB", "SM-CCCC-DDDD"])
    monkeypatch.setattr(registration, "new_reference", lambda: next(candidates))
    assert registration.unique_reference(db_session) == "SM-CCCC-DDDD"


def test_reference_generation_gives_up_after_five_collisions(db_session, monkeypatch):
    make_customer(db_session, make_user(db_session), reference="SM-AAAA-BBBB")
    monkeypatch.setattr(registration, "new_reference", lambda: "SM-AAAA-BBBB")
    with pytest.raises(RuntimeError):
        registration.unique_reference(db_session)


def test_customer_keeps_the_client_they_registered_for(join):  # noqa: F811
    client, session, _, agent, code = join
    assert client.post(f"/join/{code}/register", json=form()).status_code == 201
    original_client = session.get(AgentProfile, agent.id).client_id

    # The agent moves to another client; the customer's consent named the first.
    profile = session.get(AgentProfile, agent.id)
    profile.client_id = add_client(session, "new-client@example.com", "Beta Ltd").id
    session.commit()

    assert session.scalar(select(Customer.client_id)) == original_client


def test_migration_fills_existing_customers(test_engine):
    """0008 gives existing rows a reference, consent version 1 (the old
    wording), and the agent's current client. Rolled back afterwards."""
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    with test_engine.connect() as connection:
        transaction = connection.begin()
        config.attributes["connection"] = connection
        command.downgrade(config, "0007")
        agent, client_user = uuid4(), uuid4()
        connection.execute(
            text(
                "INSERT INTO users (id, email, role, status) VALUES "
                "(:agent, 'a@example.test', 'agent', 'approved'), "
                "(:client, 'c@example.test', 'client', 'approved')"
            ),
            {"agent": agent, "client": client_user},
        )
        connection.execute(
            text(
                "INSERT INTO agent_profiles (user_id, referral_code, display_name, "
                "client_id) VALUES (:agent, 'AGT-ABCDEFGH', 'Agent', :client)"
            ),
            {"agent": agent, "client": client_user},
        )
        for number in range(3):
            connection.execute(
                text(
                    "INSERT INTO customers (id, agent_id, full_name, email, "
                    "mobile_phone, date_of_birth, country, current_address_months, "
                    "consent_at) VALUES (:id, :agent, 'Name', :email, '0712345678', "
                    "'1990-01-01', 'KE', 12, now())"
                ),
                {"id": uuid4(), "agent": agent, "email": f"{number}@example.test"},
            )

        command.upgrade(config, "head")

        rows = connection.execute(
            text("SELECT reference, consent_version, client_id FROM customers")
        ).all()
        assert len({row.reference for row in rows}) == 3
        assert all(REFERENCE.match(row.reference) for row in rows)
        assert {(row.consent_version, row.client_id) for row in rows} == {
            (1, client_user)
        }
        transaction.rollback()


# --- Admin views ------------------------------------------------------------


def test_admin_sees_reference_and_status_per_customer(api):  # noqa: F811
    client, session, users, headers = api
    customer, assessment = add_scored_customer(session, users["agent"])
    apply_review(session, None, users["admin"], assessment, "confirmed_real", None)
    add_scored_customer(session, users["agent"], flagged=False)
    session.commit()

    detail = client.get(f"/admin/agents/{users['agent'].id}", headers=headers["admin"])
    statuses = {
        item["reference"]: item["registration_status"]
        for item in detail.json()["customers"]
    }
    assert statuses[customer.reference] == "verified"
    assert sorted(statuses.values()) == ["clear", "verified"]

    assessment_detail = client.get(
        f"/admin/assessments/{assessment.id}", headers=headers["admin"]
    ).json()
    assert assessment_detail["customer"]["reference"] == customer.reference
    assert assessment_detail["registration_status"] == "verified"


def test_agents_page_shows_which_links_are_inactive(api):  # noqa: F811
    client, session, users, headers = api
    agents = {
        row["email"]: row
        for row in client.get("/admin/agents", headers=headers["admin"]).json()
    }
    # Neither agent has a client yet.
    assert agents["agent@example.com"]["client"] is None
    assert agents["agent@example.com"]["link_active"] is False

    session.get(AgentProfile, users["agent"].id).client_id = users["client"].id
    session.commit()
    row = client.get(f"/admin/agents/{users['agent'].id}", headers=headers["admin"])
    # Assigned, but the client has no organisation name yet.
    assert row.json()["client"]["organisation_name"] is None
    assert row.json()["link_active"] is False

    session.add(ClientProfile(user_id=users["client"].id, organisation_name="Acme"))
    session.commit()
    row = client.get(f"/admin/agents/{users['agent'].id}", headers=headers["admin"])
    assert row.json()["client"]["organisation_name"] == "Acme"
    assert row.json()["link_active"] is True


def test_admin_sets_client_organisation_and_it_is_audited(api):  # noqa: F811
    client, session, users, headers = api
    url = f"/admin/clients/{users['client'].id}/organisation"

    listed = client.get("/admin/clients", headers=headers["admin"]).json()
    assert {row["email"]: row["organisation_name"] for row in listed} == {
        "client@example.com": None,
        "rival@example.com": None,
    }
    for name in ("Acme Bank", "  Acme Bank Kenya  "):
        response = client.put(
            url, headers=headers["admin"], json={"organisation_name": name}
        )
        assert response.status_code == 200
    assert response.json()["organisation_name"] == "Acme Bank Kenya"
    assert session.get(ClientProfile, users["client"].id).organisation_name == (
        "Acme Bank Kenya"
    )

    not_client = f"/admin/clients/{users['agent'].id}/organisation"
    payload = {"organisation_name": "Acme"}
    assert (
        client.put(not_client, headers=headers["admin"], json=payload).status_code
        == 404
    )
    blank = {"organisation_name": " "}
    assert client.put(url, headers=headers["admin"], json=blank).status_code == 422
    for role in ("agent", "client"):
        assert client.put(url, headers=headers[role], json=payload).status_code == 403
        assert client.get("/admin/clients", headers=headers[role]).status_code == 403

    outcomes = session.scalars(
        select(AuditLog.outcome).where(AuditLog.action == "client_organisation_updated")
    ).all()
    assert sorted(outcomes) == ["failure", "success", "success"]


def test_new_client_is_created_with_its_organisation(api):  # noqa: F811
    client, session, _, headers = api
    payload = {
        "email": "new@example.com",
        "role": "client",
        "organisation_name": " Acme Bank ",
    }
    response = client.post("/admin/users", headers=headers["admin"], json=payload)
    assert response.status_code == 201
    assert session.get(ClientProfile, response.json()["id"]).organisation_name == (
        "Acme Bank"
    )


@pytest.mark.parametrize(
    "payload",
    [
        {"email": "new@example.com", "role": "client"},
        {"email": "new@example.com", "role": "admin", "organisation_name": "Acme"},
    ],
)
def test_organisation_name_is_required_for_clients_only(api, payload):  # noqa: F811
    client, session, _, headers = api
    response = client.post("/admin/users", headers=headers["admin"], json=payload)
    assert response.status_code == 422
    assert session.scalar(select(User).where(User.email == "new@example.com")) is None
