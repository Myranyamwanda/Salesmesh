"""Reviews, reputation, scoring settings, model reload, and the agent and
client endpoints, including role-based access and agent privacy."""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from model_fixtures import tiny_state
from sqlalchemy import select
from test_auth import add_user, auth_context, bearer_headers, sign_in  # noqa: F401
from test_domain_tables import make_assessment, make_customer

from app.core.config import get_settings
from app.ml.model_service import ModelService
from app.models import AgentProfile, AuditLog, Customer, ScoringConfig
from app.services.agents import create_agent_profile
from app.services.reputation import reputation_score

CONFIG = {
    "p0": 0.0539,
    "k": 10,
    "min_users_for_band": 30,
    "high_risk_below": 90,
    "watch_below": 92,
    "device_email_rule_min": 3,
}
SECRET_WORDS = (
    "reputation",
    "risk",
    "band",
    "status",
    "probability",
    "reason",
    "feature",
    "flag",
    "verified",
    "pending",
    "rejected",
)


@pytest.fixture
def api(auth_context):  # noqa: F811
    client, session, _, _ = auth_context
    users = {
        "admin": add_user(session, role="admin", email="admin@example.com"),
        "agent": add_user(session, role="agent", email="agent@example.com"),
        "other_agent": add_user(session, role="agent", email="other@example.com"),
        "client": add_user(session, role="client", email="client@example.com"),
        "other_client": add_user(session, role="client", email="rival@example.com"),
    }
    create_agent_profile(session, users["agent"], "Amina Otieno")
    create_agent_profile(session, users["other_agent"], "Brian Mwangi")
    session.commit()
    headers = {
        role: bearer_headers(sign_in(client, user.email))
        for role, user in users.items()
    }
    return client, session, users, headers


def add_scored_customer(session, agent, flagged=True, status=None, **overrides):
    customer = make_customer(
        session,
        agent,
        email=f"{uuid4()}@example.test",
        status=status or ("pending_review" if flagged else "verified"),
        **overrides,
    )
    assessment = make_assessment(session, customer, flagged=flagged)
    session.commit()
    return customer, assessment


# --- Review queue and assessment detail -------------------------------------


def test_review_queue_lists_flagged_unreviewed_assessments(api):
    client, session, users, headers = api
    _, first = add_scored_customer(session, users["agent"])
    _, second = add_scored_customer(session, users["other_agent"])
    add_scored_customer(session, users["agent"], flagged=False)
    # One test transaction gives every row the same now(); set the order.
    first.created_at = datetime(2026, 10, 1, tzinfo=UTC)
    second.created_at = datetime(2026, 10, 2, tzinfo=UTC)
    session.commit()

    response = client.get("/admin/review-queue", headers=headers["admin"])

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert [item["assessment_id"] for item in body["items"]] == [
        str(first.id),
        str(second.id),
    ]
    item = body["items"][0]
    assert item["probability"] == 0.05
    assert item["reasons"][0]["text"] == "No previous address provided"
    assert item["agent"]["display_name"] == "Amina Otieno"
    assert item["customer_name"] == "Wanjiru Kamau"


def test_assessment_detail_shows_everything_to_admins(api):
    client, session, users, headers = api
    customer, assessment = add_scored_customer(session, users["agent"])

    body = client.get(
        f"/admin/assessments/{assessment.id}", headers=headers["admin"]
    ).json()

    assert body["probability"] == 0.05
    assert body["features"] == {"source": "INTERNET"}
    assert body["customer"]["email"] == customer.email
    assert body["agent"]["id"] == str(users["agent"].id)
    assert body["review"] is None
    assert (
        client.get(
            f"/admin/assessments/{uuid4()}", headers=headers["admin"]
        ).status_code
        == 404
    )


# --- Review workflow ---------------------------------------------------------


def reputation(client, headers, agent):
    return client.get(f"/admin/agents/{agent.id}", headers=headers["admin"]).json()


def test_confirmed_real_removes_the_flag(api):
    client, session, users, headers = api
    customer, assessment = add_scored_customer(session, users["agent"])
    before = reputation(client, headers, users["agent"])
    assert before["flags"] == 1

    response = client.post(
        f"/admin/assessments/{assessment.id}/review",
        headers=headers["admin"],
        json={"decision": "confirmed_real", "notes": "Called the customer"},
    )

    assert response.status_code == 201
    assert response.json()["decision"] == "confirmed_real"
    session.expire_all()
    assert session.get(Customer, customer.id).status == "verified"
    after = reputation(client, headers, users["agent"])
    assert after["flags"] == 0
    assert after["reputation"] > before["reputation"]
    assert (
        client.get("/admin/review-queue", headers=headers["admin"]).json()["total"] == 0
    )
    entry = session.scalar(
        select(AuditLog).where(AuditLog.action == "assessment_reviewed")
    )
    assert entry.subject == f"assessment:{assessment.id}"
    assert entry.target_user_id == users["agent"].id
    assert entry.actor_user_id == users["admin"].id


def test_confirmed_fake_rejects_the_customer_and_keeps_the_flag(api):
    client, session, users, headers = api
    customer, assessment = add_scored_customer(session, users["agent"])

    client.post(
        f"/admin/assessments/{assessment.id}/review",
        headers=headers["admin"],
        json={"decision": "confirmed_fake"},
    )

    session.expire_all()
    assert session.get(Customer, customer.id).status == "rejected"
    stats = reputation(client, headers, users["agent"])
    assert (stats["flags"], stats["confirmed_fake"]) == (1, 1)


def test_unflagged_assessment_can_be_confirmed_fake(api):
    client, session, users, headers = api
    _, assessment = add_scored_customer(session, users["agent"], flagged=False)
    assert reputation(client, headers, users["agent"])["flags"] == 0
    client.post(
        f"/admin/assessments/{assessment.id}/review",
        headers=headers["admin"],
        json={"decision": "confirmed_fake"},
    )
    assert reputation(client, headers, users["agent"])["flags"] == 1


def test_assessment_can_be_reviewed_only_once(api):
    client, session, users, headers = api
    _, assessment = add_scored_customer(session, users["agent"])
    url = f"/admin/assessments/{assessment.id}/review"
    assert (
        client.post(
            url, headers=headers["admin"], json={"decision": "confirmed_fake"}
        ).status_code
        == 201
    )
    second = client.post(
        url, headers=headers["admin"], json={"decision": "confirmed_real"}
    )
    assert second.status_code == 409
    failures = session.scalars(
        select(AuditLog).where(
            AuditLog.action == "assessment_reviewed", AuditLog.outcome == "failure"
        )
    ).all()
    assert len(failures) == 1


@pytest.mark.parametrize(
    "payload",
    [{"decision": "maybe"}, {}, {"decision": "confirmed_fake", "notes": "x" * 1001}],
)
def test_invalid_reviews_are_rejected(api, payload):
    client, session, users, headers = api
    _, assessment = add_scored_customer(session, users["agent"])
    response = client.post(
        f"/admin/assessments/{assessment.id}/review",
        headers=headers["admin"],
        json=payload,
    )
    assert response.status_code == 422


def test_review_of_unknown_assessment_is_404(api):
    client, _, _, headers = api
    response = client.post(
        f"/admin/assessments/{uuid4()}/review",
        headers=headers["admin"],
        json={"decision": "confirmed_fake"},
    )
    assert response.status_code == 404


# --- Agent ranking, detail, and profile updates ------------------------------


def test_agents_ranking_is_sorted_worst_first(api):
    client, session, users, headers = api
    for _ in range(3):
        add_scored_customer(session, users["agent"])
    add_scored_customer(session, users["other_agent"], flagged=False, assisted=True)

    body = client.get("/admin/agents", headers=headers["admin"]).json()

    assert [row["display_name"] for row in body] == ["Amina Otieno", "Brian Mwangi"]
    worst = body[0]
    assert (worst["n_users"], worst["flags"], worst["pending_review"]) == (3, 3, 3)
    assert worst["reputation"] == reputation_score(3, 3, 10, 0.0539)
    assert worst["risk_score"] == round(100 - worst["reputation"], 1)
    assert worst["band"] == "Insufficient data"
    assert body[1]["assisted_share"] == 1.0


def test_agent_detail_lists_customers_with_scores(api):
    client, session, users, headers = api
    _, assessment = add_scored_customer(session, users["agent"])

    body = reputation(client, headers, users["agent"])

    assert body["customers_total"] == 1
    assert body["customers"][0]["assessment_id"] == str(assessment.id)
    assert body["customers"][0]["probability"] == 0.05
    assert (
        client.get(f"/admin/agents/{uuid4()}", headers=headers["admin"]).status_code
        == 404
    )
    admin_id = users["admin"].id
    assert (
        client.get(f"/admin/agents/{admin_id}", headers=headers["admin"]).status_code
        == 404
    )


def test_admin_assigns_client_and_renames_agent(api):
    client, session, users, headers = api
    url = f"/admin/agents/{users['agent'].id}"

    response = client.patch(
        url,
        headers=headers["admin"],
        json={"client_id": str(users["client"].id), "display_name": " Amina O. "},
    )

    assert response.status_code == 200
    assert response.json()["client"]["email"] == "client@example.com"
    assert response.json()["display_name"] == "Amina O."
    assert (
        client.patch(url, headers=headers["admin"], json={}).json()["client"]
        is not None
    )
    unassigned = client.patch(url, headers=headers["admin"], json={"client_id": None})
    assert unassigned.json()["client"] is None
    session.expire_all()
    assert session.get(AgentProfile, users["agent"].id).display_name == "Amina O."
    assert (
        len(
            session.scalars(
                select(AuditLog).where(AuditLog.action == "agent_profile_updated")
            ).all()
        )
        == 3
    )


@pytest.mark.parametrize(
    "payload",
    [{"client_id": "agent"}, {"client_id": "missing"}, {"display_name": None}],
)
def test_invalid_agent_updates_are_rejected(api, payload):
    client, _, users, headers = api
    values = {"agent": str(users["other_agent"].id), "missing": str(uuid4())}
    if "client_id" in payload:
        payload = {"client_id": values[payload["client_id"]]}
    response = client.patch(
        f"/admin/agents/{users['agent'].id}", headers=headers["admin"], json=payload
    )
    assert response.status_code == 422


# --- Scoring config ----------------------------------------------------------


def test_scoring_config_read_and_update(api):
    client, session, users, headers = api
    for _ in range(30):
        add_scored_customer(session, users["agent"], flagged=False)
    assert reputation(client, headers, users["agent"])["band"] == "Low risk"

    current = client.get("/admin/scoring-config", headers=headers["admin"]).json()
    assert {name: current[name] for name in CONFIG} == CONFIG
    assert current["updated_by"] is None

    updated = CONFIG | {
        "high_risk_below": 99,
        "watch_below": 99.5,
        "device_email_rule_min": 4,
    }
    response = client.put(
        "/admin/scoring-config", headers=headers["admin"], json=updated
    )

    assert response.status_code == 200
    assert response.json()["device_email_rule_min"] == 4
    assert response.json()["updated_by"] == str(users["admin"].id)
    session.expire_all()
    assert session.get(ScoringConfig, 1).high_risk_below == 99
    # Reputation is calculated on read, so the new bands apply at once.
    assert reputation(client, headers, users["agent"])["band"] == "High risk"
    entry = session.scalar(
        select(AuditLog).where(AuditLog.action == "scoring_config_updated")
    )
    assert entry.subject == "scoring_config:1"


@pytest.mark.parametrize(
    "change",
    [
        {"p0": 0},
        {"p0": 1},
        {"k": 0},
        {"min_users_for_band": 0},
        {"high_risk_below": 93},
        {"watch_below": 101},
        {"device_email_rule_min": 2},
    ],
)
def test_invalid_scoring_config_is_rejected(api, change):
    client, session, _, headers = api
    response = client.put(
        "/admin/scoring-config", headers=headers["admin"], json=CONFIG | change
    )
    assert response.status_code == 422
    session.expire_all()
    assert session.get(ScoringConfig, 1).p0 == 0.0539


# --- Model reload ------------------------------------------------------------


def test_model_reload_success_is_audited(api, monkeypatch):
    client, session, _, headers = api
    monkeypatch.setattr(
        "app.ml.model_service.load_model_state", lambda settings: tiny_state()
    )

    response = client.post("/admin/model/reload", headers=headers["admin"])

    assert response.status_code == 200
    assert response.json()["model_version"] == "test-tiny"
    assert client.app.state.model_service.state.metadata["model_version"] == "test-tiny"
    entry = session.scalar(select(AuditLog).where(AuditLog.action == "model_reloaded"))
    assert (entry.outcome, entry.subject) == ("success", "model_version:test-tiny")


def test_failed_reload_keeps_the_working_model(api):
    client, session, _, headers = api
    working = tiny_state()
    client.app.state.model_service = ModelService(working)
    current = client.app.dependency_overrides[get_settings]()
    broken = current.model_copy(update={"model_dir": current.model_dir / "missing"})
    client.app.dependency_overrides[get_settings] = lambda: broken

    response = client.post("/admin/model/reload", headers=headers["admin"])

    assert response.status_code == 409
    assert "current model is still in use" in response.json()["error"]["message"]
    assert client.app.state.model_service.state is working
    entry = session.scalar(select(AuditLog).where(AuditLog.action == "model_reloaded"))
    assert entry.outcome == "failure"


# --- Agent endpoints ---------------------------------------------------------


def test_agent_sees_referral_link(api):
    client, session, users, headers = api
    body = client.get("/me/referral", headers=headers["agent"]).json()
    code = session.get(AgentProfile, users["agent"].id).referral_code
    assert body == {
        "referral_code": code,
        "display_name": "Amina Otieno",
        "link": f"{get_settings().frontend_url}/join/{code}",
    }


def test_agent_sees_only_own_customers_without_scores(api):
    client, session, users, headers = api
    add_scored_customer(session, users["agent"], full_name="Flagged Person")
    add_scored_customer(
        session, users["agent"], flagged=False, full_name="Clean Person", assisted=True
    )
    add_scored_customer(session, users["other_agent"], full_name="Not Mine")

    response = client.get("/me/customers", headers=headers["agent"])

    body = response.json()
    assert body["total"] == 2
    assert {item["full_name"] for item in body["items"]} == {
        "Flagged Person",
        "Clean Person",
    }
    for item in body["items"]:
        assert set(item) == {"full_name", "registered_at", "assisted"}


def test_no_agent_endpoint_reveals_scores_or_status(api):
    client, session, users, headers = api
    add_scored_customer(session, users["agent"])
    add_scored_customer(session, users["agent"], status="rejected")
    for path in ("/me/referral", "/me/customers"):
        text = client.get(path, headers=headers["agent"]).text.lower()
        for word in SECRET_WORDS:
            assert word not in text, (path, word)
    assert client.get("/me/reputation", headers=headers["agent"]).status_code == 404


# --- Client quality ----------------------------------------------------------


def test_client_sees_only_their_agents_customers(api):
    client, session, users, headers = api
    session.get(AgentProfile, users["agent"].id).client_id = users["client"].id
    session.get(AgentProfile, users["other_agent"].id).client_id = users[
        "other_client"
    ].id
    session.commit()
    add_scored_customer(session, users["agent"], flagged=False)
    add_scored_customer(session, users["agent"], flagged=False)
    add_scored_customer(session, users["agent"], flagged=True)
    _, fake = add_scored_customer(session, users["agent"], flagged=True)
    add_scored_customer(session, users["other_agent"], flagged=True)
    client.post(
        f"/admin/assessments/{fake.id}/review",
        headers=headers["admin"],
        json={"decision": "confirmed_fake"},
    )

    body = client.get("/client/quality", headers=headers["client"]).json()

    assert (body["registrations"], body["flagged"], body["confirmed_fake"]) == (4, 2, 1)
    assert (body["flagged_percent"], body["confirmed_fake_percent"]) == (50.0, 25.0)
    assert body["pending_review"] == 1
    assert len(body["trend"]) == 12
    this_month = datetime.now(UTC).strftime("%Y-%m")
    assert body["trend"][-1] == {
        "month": this_month,
        "registrations": 4,
        "flagged": 2,
        "confirmed_fake": 1,
    }
    assert sum(month["registrations"] for month in body["trend"]) == 4
    for word in ("probability", "reason", "feature", "reputation"):
        assert word not in str(body).lower()


def test_client_without_agents_sees_zeros(api):
    client, _, _, headers = api
    body = client.get("/client/quality", headers=headers["other_client"]).json()
    assert body["registrations"] == 0
    assert body["flagged_percent"] == 0.0
    assert all(month["registrations"] == 0 for month in body["trend"])


# --- Role-based access -------------------------------------------------------

ADMIN_ENDPOINTS = [
    ("get", "/admin/review-queue"),
    ("get", "/admin/assessments/{id}"),
    ("post", "/admin/assessments/{id}/review"),
    ("get", "/admin/agents"),
    ("get", "/admin/agents/{id}"),
    ("patch", "/admin/agents/{id}"),
    ("get", "/admin/scoring-config"),
    ("put", "/admin/scoring-config"),
    ("get", "/admin/model"),
    ("post", "/admin/model/reload"),
]
AGENT_ENDPOINTS = [("get", "/me/referral"), ("get", "/me/customers")]
CLIENT_ENDPOINTS = [("get", "/client/quality")]
ALLOWED = (
    [(method, path, "admin") for method, path in ADMIN_ENDPOINTS]
    + [(method, path, "agent") for method, path in AGENT_ENDPOINTS]
    + [(method, path, "client") for method, path in CLIENT_ENDPOINTS]
)


def call(client, method, path, headers=None):
    url = path.replace("{id}", str(uuid4()))
    body = {"decision": "confirmed_fake"} if "review" in path else CONFIG
    if method == "get":
        return client.get(url, headers=headers)
    return getattr(client, method)(url, headers=headers, json=body)


@pytest.mark.parametrize(("method", "path", "owner"), ALLOWED)
def test_wrong_roles_get_403(api, method, path, owner):
    client, _, _, headers = api
    for role in ("admin", "agent", "client"):
        if role != owner:
            response = call(client, method, path, headers[role])
            assert response.status_code == 403, (role, method, path)


@pytest.mark.parametrize(("method", "path", "owner"), ALLOWED)
def test_missing_token_gets_401(api, method, path, owner):
    client, _, _, _ = api
    assert call(client, method, path).status_code == 401
