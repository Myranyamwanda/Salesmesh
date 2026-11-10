"""The three safeguards for assisted registrations (v1.3.0).

1. Assisted registrations are compared with their own threshold.
2. A share of the unflagged ones is picked at random for review: not a flag.
3. Agents with far more assisted registrations than the network are marked.
"""

from uuid import uuid4

import pytest
from model_fixtures import tiny_state
from sqlalchemy import select
from test_auth import add_user, auth_context, bearer_headers, sign_in  # noqa: F401
from test_domain_tables import make_assessment, make_customer
from test_phase4_api import CONFIG, SECRET_WORDS, add_scored_customer, api  # noqa: F401

from app.ml.model_service import ModelService
from app.models import AgentProfile, Customer, ScoringConfig
from app.services import scoring
from app.services.agents import create_agent_profile
from app.services.scoring import AUDIT_REASON, score_customer

FEATURES = {
    "prev_address_months_count": None,
    "current_address_months_count": 24.0,
    "date_of_birth_distinct_emails_4w": 0,
    "email_is_free": 1,
    "phone_home_valid": 0,
    "phone_mobile_valid": 1,
    "foreign_request": None,
    "source": "INTERNET",
    "session_length_in_minutes": None,
    "device_os": None,
    "device_distinct_emails_8w": None,
}
NEVER = 1.0  # Standard threshold that flags no one.


def configure(session, **values):
    config = session.get(ScoringConfig, 1)
    for name, value in values.items():
        setattr(config, name, value)
    session.flush()


def scored(session, agent, assisted, draw=lambda: 0.99, standard=NEVER):
    customer = make_customer(
        session,
        agent,
        email=f"{uuid4()}@example.test",
        assisted=assisted,
        status="verified",
    )
    return customer, score_customer(
        session, ModelService(tiny_state(standard)), customer, FEATURES, draw
    )


@pytest.fixture
def agent(db_session):
    user = add_user(db_session, role="agent", email="agent@example.com")
    create_agent_profile(db_session, user, "Amina Otieno")
    return user


# --- 1. Assisted threshold ----------------------------------------------------


def test_assisted_registration_above_the_assisted_threshold_is_flagged(
    db_session, agent
):
    configure(db_session, assisted_threshold=1e-9)

    customer, assessment = scored(db_session, agent, assisted=True)

    assert assessment.flagged
    assert assessment.threshold == 1e-9
    assert assessment.threshold_kind == "assisted"
    assert customer.status == "pending_review"
    assert not assessment.audit_selected


def test_assisted_registration_below_the_assisted_threshold_is_not_flagged(
    db_session, agent
):
    configure(db_session, assisted_threshold=0.999999)

    customer, assessment = scored(db_session, agent, assisted=True)

    assert not assessment.flagged
    assert assessment.threshold_kind == "assisted"
    assert customer.status == "verified"


def test_other_registrations_keep_the_model_threshold(db_session, agent):
    configure(db_session, assisted_threshold=1e-9)

    _, assessment = scored(db_session, agent, assisted=False)

    assert not assessment.flagged
    assert assessment.threshold == NEVER
    assert assessment.threshold_kind == "standard"


# --- 2. Random audit -----------------------------------------------------------


@pytest.mark.parametrize(
    ("draw", "share", "selected"),
    [(0.05, 0.1, True), (0.1, 0.1, False), (0.99, 1.0, True), (0.0, 0.0, False)],
)
def test_audit_selects_by_share(db_session, agent, draw, share, selected):
    configure(db_session, assisted_threshold=0.999999, audit_share=share)

    customer, assessment = scored(db_session, agent, assisted=True, draw=lambda: draw)

    assert assessment.audit_selected is selected
    assert not assessment.flagged
    assert customer.status == "verified"
    assert (assessment.reasons[0] == AUDIT_REASON) is selected


def test_only_unflagged_assisted_registrations_are_audited(db_session, agent):
    configure(db_session, assisted_threshold=1e-9, audit_share=1.0)
    _, flagged = scored(db_session, agent, assisted=True, draw=lambda: 0.0)
    _, standard = scored(
        db_session, agent, assisted=False, draw=lambda: 0.0, standard=NEVER
    )

    assert flagged.flagged and not flagged.audit_selected
    assert not standard.audit_selected


def test_audits_use_a_secure_random_source(db_session, agent, monkeypatch):
    configure(db_session, assisted_threshold=0.999999, audit_share=0.5)
    monkeypatch.setattr(scoring.SECURE_RANDOM, "random", lambda: 0.1)
    customer = make_customer(
        db_session, agent, email="secure@example.test", assisted=True
    )

    assessment = score_customer(
        db_session, ModelService(tiny_state(NEVER)), customer, FEATURES
    )

    assert assessment.audit_selected
    assert type(scoring.SECURE_RANDOM).__name__ == "SystemRandom"


def audited_customer(session, agent):
    customer = make_customer(
        session, agent, email=f"{uuid4()}@example.test", status="verified"
    )
    assessment = make_assessment(
        session,
        customer,
        flagged=False,
        audit_selected=True,
        threshold_kind="assisted",
        reasons=[AUDIT_REASON],
    )
    session.commit()
    return customer, assessment


def reputation(client, headers, agent_id):
    return client.get(f"/admin/agents/{agent_id}", headers=headers["admin"]).json()


def test_random_audits_reach_the_queue_but_count_as_nothing(api):  # noqa: F811
    client, session, users, headers = api
    for _ in range(3):
        add_scored_customer(session, users["agent"], flagged=False)
    before = reputation(client, headers, users["agent"].id)
    _, assessment = audited_customer(session, users["agent"])

    queue = client.get("/admin/review-queue", headers=headers["admin"]).json()
    after = reputation(client, headers, users["agent"].id)
    kpis = client.get(
        f"/admin/agents/{users['agent'].id}/kpis", headers=headers["admin"]
    ).json()
    eligibility = client.get("/admin/eligibility", headers=headers["admin"]).json()

    assert [item["assessment_id"] for item in queue["items"]] == [str(assessment.id)]
    assert queue["items"][0]["audit"] is True
    assert queue["items"][0]["reasons"][0]["source"] == "audit"
    # 4 registrations, no flags: the audit lowers nothing.
    assert (after["flags"], after["pending_review"]) == (0, 0)
    assert after["reputation"] > before["reputation"]
    assert sum(month["flagged"] for month in kpis["months"]) == 0
    assert eligibility["totals"] == {"eligible": 4, "pending": 0, "not_eligible": 0}
    detail = client.get(
        f"/admin/assessments/{assessment.id}", headers=headers["admin"]
    ).json()
    assert (detail["audit_selected"], detail["threshold_kind"]) == (True, "assisted")
    assert detail["registration_status"] == "clear"


def test_an_audit_confirmed_fake_counts_as_usual(api):  # noqa: F811
    client, session, users, headers = api
    _, assessment = audited_customer(session, users["agent"])

    response = client.post(
        f"/admin/assessments/{assessment.id}/review",
        headers=headers["admin"],
        json={"decision": "confirmed_fake"},
    )

    assert response.status_code == 201
    stats = reputation(client, headers, users["agent"].id)
    assert (stats["flags"], stats["confirmed_fake"]) == (1, 1)
    eligibility = client.get("/admin/eligibility", headers=headers["admin"]).json()
    assert eligibility["totals"]["not_eligible"] == 1
    queue = client.get("/admin/review-queue", headers=headers["admin"]).json()
    assert queue["total"] == 0


def test_an_audit_confirmed_real_changes_nothing(api):  # noqa: F811
    client, session, users, headers = api
    customer, assessment = audited_customer(session, users["agent"])

    client.post(
        f"/admin/assessments/{assessment.id}/review",
        headers=headers["admin"],
        json={"decision": "confirmed_real"},
    )

    session.expire_all()
    assert session.get(Customer, customer.id).status == "verified"
    assert reputation(client, headers, users["agent"].id)["flags"] == 0


# --- 3. Assisted-share alert ---------------------------------------------------


def add_customers(session, agent, total, assisted):
    for number in range(total):
        add_scored_customer(session, agent, flagged=False, assisted=number < assisted)


def test_alert_marks_agents_far_above_the_network_share(api):  # noqa: F811
    client, session, users, headers = api
    # Network: 15 assisted of 70 (21%). Amina: 15 of 30 (50%) > 2 x 21%.
    add_customers(session, users["agent"], 30, 15)
    add_customers(session, users["other_agent"], 40, 0)

    agents = {
        row["display_name"]: row
        for row in client.get("/admin/agents", headers=headers["admin"]).json()
    }
    benchmark = {
        row["agent"]["display_name"]: row
        for row in client.get("/admin/kpis", headers=headers["admin"]).json()[
            "benchmark"
        ]
    }

    assert agents["Amina Otieno"]["assisted_alert"] is True
    assert agents["Brian Mwangi"]["assisted_alert"] is False
    assert benchmark["Amina Otieno"]["assisted_alert"] is True
    assert benchmark["Brian Mwangi"]["assisted_alert"] is False
    assert reputation(client, headers, users["agent"].id)["assisted_alert"] is True


def test_alert_needs_enough_registrations(api):  # noqa: F811
    client, session, users, headers = api
    add_customers(session, users["agent"], 29, 29)
    add_customers(session, users["other_agent"], 100, 0)

    assert reputation(client, headers, users["agent"].id)["assisted_alert"] is False


def test_alert_follows_the_multiple_setting(api):  # noqa: F811
    client, session, users, headers = api
    add_customers(session, users["agent"], 30, 15)
    add_customers(session, users["other_agent"], 40, 0)
    client.put(
        "/admin/scoring-config",
        headers=headers["admin"],
        json=CONFIG | {"assisted_alert_multiple": 3.0},
    )

    # 50% is not more than 3 x 21%.
    assert reputation(client, headers, users["agent"].id)["assisted_alert"] is False


# --- Privacy: agents and clients never see audits or alerts ---------------------


def test_agents_and_clients_never_see_audits_or_alerts(api):  # noqa: F811
    client, session, users, headers = api
    session.get(AgentProfile, users["agent"].id).client_id = users["client"].id
    session.commit()
    add_customers(session, users["agent"], 30, 30)
    add_customers(session, users["other_agent"], 40, 0)
    for customer in session.scalars(
        select(Customer).where(Customer.agent_id == users["agent"].id)
    ):
        customer.client_id = users["client"].id
    customer, assessment = audited_customer(session, users["agent"])
    customer.client_id = users["client"].id
    session.commit()
    assert reputation(client, headers, users["agent"].id)["assisted_alert"] is True

    pages = {
        "agent": ("/me/referral", "/me/customers", "/me/standing", "/me/activity"),
        "client": (
            "/client/quality",
            "/client/eligibility",
            "/client/customers/export.csv",
        ),
    }
    for role, paths in pages.items():
        for path in paths:
            response = client.get(path, headers=headers[role])
            assert response.status_code == 200, path
            text = response.text.lower()
            for word in ("audit", "alert", "threshold", "assisted_alert"):
                assert word not in text, (path, word)
    quality = client.get("/client/quality", headers=headers["client"]).json()
    # The audit is not "under review" for the client.
    assert quality["under_review"] == 0
    activity = client.get("/me/customers", headers=headers["agent"]).json()
    assert set(activity["items"][0]) == {"full_name", "registered_at", "assisted"}
