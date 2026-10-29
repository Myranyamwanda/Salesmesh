import re
from datetime import UTC, date, datetime
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError, IntegrityError
from test_auth import (  # noqa: F401
    add_user,
    auth_context,
    bearer_headers,
    sign_in,
)

from app.ml.model_service import ModelState
from app.models import (
    AgentProfile,
    AuditLog,
    Customer,
    ModelVersion,
    Review,
    RiskAssessment,
    ScoringConfig,
    User,
)
from app.models.customer import CONSENT_VERSION
from app.services.agents import (
    PLACEHOLDER_DISPLAY_NAME,
    create_agent_profile,
    new_referral_code,
)
from app.services.model_versions import record_active_model
from app.services.registration import new_reference

REASON = {
    "source": "model",
    "code": "num__missingindicator_prev_address_months_count",
    "text": "No previous address provided",
    "contribution": 0.45,
}
CODE_PATTERN = re.compile(r"^AGT-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$")


def make_user(session, role="agent"):
    user = User(email=f"{uuid4()}@example.test", role=role)
    session.add(user)
    session.flush()
    return user


def make_customer(session, agent, **overrides):
    values = {
        "agent_id": agent.id,
        "full_name": "Wanjiru Kamau",
        "email": "wanjiru@example.test",
        "mobile_phone": "+254712345678",
        "date_of_birth": date(1995, 5, 17),
        "country": "KE",
        "current_address_months": 24,
        "consent_at": datetime.now(UTC),
        "consent_version": CONSENT_VERSION,
        "reference": new_reference(),
    }
    customer = Customer(**(values | overrides))
    session.add(customer)
    session.flush()
    return customer


def make_assessment(session, customer, **overrides):
    if session.get(ModelVersion, "test") is None:
        session.add(
            ModelVersion(version="test", loaded_at=datetime.now(UTC), metrics={})
        )
    values = {
        "customer_id": customer.id,
        "model_version": "test",
        "probability": 0.05,
        "threshold": 0.035,
        "flagged": True,
        "reasons": [REASON],
        "features": {"source": "INTERNET"},
    }
    assessment = RiskAssessment(**(values | overrides))
    session.add(assessment)
    session.flush()
    return assessment


def expect_integrity_error(session):
    with pytest.raises(IntegrityError):
        session.flush()


def test_scoring_config_has_approved_defaults(db_session):
    config = db_session.get(ScoringConfig, 1)
    assert (
        config.p0,
        config.k,
        config.min_users_for_band,
        config.high_risk_below,
        config.watch_below,
    ) == (0.0539, 10, 30, 90, 92)
    assert db_session.scalars(select(ScoringConfig)).all() == [config]


def test_scoring_config_allows_only_one_row(db_session):
    db_session.add(ScoringConfig(id=2))
    expect_integrity_error(db_session)


@pytest.mark.parametrize(
    "change",
    [
        {"p0": 0},
        {"p0": 1},
        {"k": 0},
        {"min_users_for_band": 0},
        {"high_risk_below": 95},
        {"watch_below": 101},
    ],
)
def test_scoring_config_rejects_invalid_values(db_session, change):
    config = db_session.get(ScoringConfig, 1)
    for name, value in change.items():
        setattr(config, name, value)
    expect_integrity_error(db_session)


def test_customer_defaults_and_storage(db_session):
    customer = make_customer(db_session, make_user(db_session), device_id=uuid4())
    db_session.refresh(customer)
    assert customer.status == "pending_review"
    assert customer.assisted is False
    assert customer.previous_address_months is None
    assert customer.created_at is not None


@pytest.mark.parametrize(
    "override",
    [
        {"status": "approved"},
        {"email": "Upper@Example.test"},
        {"country": "ke"},
        {"country": "KEN"},
        {"current_address_months": -1},
        {"previous_address_months": -1},
    ],
)
def test_customer_rejects_invalid_values(db_session, override):
    agent = make_user(db_session)
    # DBAPIError covers CHECK failures and "KEN" being too long for the column.
    with pytest.raises(DBAPIError):
        make_customer(db_session, agent, **override)


def test_customer_requires_existing_agent(db_session):
    db_session.add(
        Customer(
            agent_id=uuid4(),
            full_name="No Agent",
            email="none@example.test",
            mobile_phone="+254700000000",
            date_of_birth=date(1990, 1, 1),
            country="KE",
            current_address_months=1,
            consent_at=datetime.now(UTC),
            consent_version=CONSENT_VERSION,
            reference=new_reference(),
        )
    )
    expect_integrity_error(db_session)


def test_agent_with_customers_cannot_be_deleted(db_session):
    agent = make_user(db_session)
    make_customer(db_session, agent)
    db_session.delete(agent)
    expect_integrity_error(db_session)


def test_deleting_customer_removes_assessments_and_reviews(db_session):
    customer = make_customer(db_session, make_user(db_session))
    assessment = make_assessment(db_session, customer)
    db_session.add(Review(assessment_id=assessment.id, decision="confirmed_fake"))
    db_session.flush()

    db_session.delete(customer)
    db_session.flush()
    db_session.expire_all()

    assert db_session.scalar(select(RiskAssessment)) is None
    assert db_session.scalar(select(Review)) is None


@pytest.mark.parametrize("probability", [-0.01, 1.01])
def test_assessment_probability_must_be_between_0_and_1(db_session, probability):
    customer = make_customer(db_session, make_user(db_session))
    with pytest.raises(IntegrityError):
        make_assessment(db_session, customer, probability=probability)


def test_assessment_requires_known_model_version(db_session):
    customer = make_customer(db_session, make_user(db_session))
    db_session.add(
        RiskAssessment(
            customer_id=customer.id,
            model_version="unknown",
            probability=0.1,
            threshold=0.035,
            flagged=True,
            reasons=[],
            features={},
        )
    )
    expect_integrity_error(db_session)


def test_assessment_stores_json(db_session):
    customer = make_customer(db_session, make_user(db_session))
    features = {"prev_address_months_count": None, "device_os": "windows"}
    assessment = make_assessment(db_session, customer, features=features)
    db_session.expire_all()
    stored = db_session.get(RiskAssessment, assessment.id)
    assert stored.features == features
    assert stored.reasons == [REASON]


def test_only_one_review_per_assessment(db_session):
    assessment = make_assessment(
        db_session, make_customer(db_session, make_user(db_session))
    )
    db_session.add(Review(assessment_id=assessment.id, decision="confirmed_real"))
    db_session.flush()
    db_session.add(Review(assessment_id=assessment.id, decision="confirmed_fake"))
    expect_integrity_error(db_session)


def test_review_rejects_unknown_decision(db_session):
    assessment = make_assessment(
        db_session, make_customer(db_session, make_user(db_session))
    )
    db_session.add(Review(assessment_id=assessment.id, decision="maybe"))
    expect_integrity_error(db_session)


def test_only_one_model_version_can_be_active(db_session):
    now = datetime.now(UTC)
    db_session.add(ModelVersion(version="a", loaded_at=now, metrics={}, active=True))
    db_session.flush()
    db_session.add(ModelVersion(version="b", loaded_at=now, metrics={}, active=True))
    expect_integrity_error(db_session)


def loaded_state(version):
    return ModelState(
        status="ok",
        source="local",
        loaded_at=datetime.now(UTC),
        metadata={"model_version": version, "metrics_test": {"ROC-AUC": 0.8}},
    )


def test_record_active_model_switches_the_active_version(db_session):
    record_active_model(db_session, loaded_state("v1"))
    db_session.flush()
    record_active_model(db_session, loaded_state("v2"))
    db_session.flush()
    record_active_model(db_session, loaded_state("v1"))
    db_session.flush()

    rows = {row.version: row for row in db_session.scalars(select(ModelVersion))}
    assert rows["v1"].active and not rows["v2"].active
    assert rows["v1"].metrics == {"ROC-AUC": 0.8}


def test_referral_codes_are_random_and_well_formed():
    codes = {new_referral_code() for _ in range(200)}
    assert len(codes) == 200
    assert all(CODE_PATTERN.match(code) for code in codes)


def test_agent_profile_rejects_malformed_codes(db_session):
    db_session.add(
        AgentProfile(
            user_id=make_user(db_session).id,
            referral_code="AGT-0000OOOO",
            display_name="Bad code",
        )
    )
    expect_integrity_error(db_session)


def test_referral_codes_are_unique(db_session):
    first = create_agent_profile(db_session, make_user(db_session))
    db_session.flush()
    db_session.add(
        AgentProfile(
            user_id=make_user(db_session).id,
            referral_code=first.referral_code,
            display_name="Copy",
        )
    )
    expect_integrity_error(db_session)


def test_client_deletion_unassigns_agents(db_session):
    client = make_user(db_session, role="client")
    profile = create_agent_profile(db_session, make_user(db_session))
    profile.client_id = client.id
    db_session.flush()

    db_session.delete(client)
    db_session.flush()
    db_session.expire_all()

    assert db_session.get(AgentProfile, profile.user_id).client_id is None


def test_audit_log_stores_subject(db_session):
    db_session.add(
        AuditLog(action="model_reloaded", outcome="success", subject="model_version:v1")
    )
    db_session.flush()
    assert db_session.scalar(select(AuditLog)).subject == "model_version:v1"


def test_registration_creates_agent_profile(auth_context):  # noqa: F811
    client, session, fake_firebase, _ = auth_context
    uid = fake_firebase.add_user("amina@example.com")
    response = client.post(
        "/auth/firebase/register",
        json={"id_token": fake_firebase.token(uid), "display_name": "  Amina Otieno  "},
    )
    assert response.status_code == 201

    profile = session.get(AgentProfile, response.json()["id"])
    assert profile.display_name == "Amina Otieno"
    assert CODE_PATTERN.match(profile.referral_code)
    assert profile.client_id is None


@pytest.mark.parametrize("display_name", [None, "", "   ", "A", "x" * 101])
def test_registration_requires_a_display_name(auth_context, display_name):  # noqa: F811
    client, session, fake_firebase, _ = auth_context
    payload = {"id_token": fake_firebase.token(fake_firebase.add_user("a@example.com"))}
    if display_name is not None:
        payload["display_name"] = display_name
    assert client.post("/auth/firebase/register", json=payload).status_code == 422
    assert session.scalar(select(User)) is None


def test_role_change_to_agent_creates_profile_once(auth_context):  # noqa: F811
    client, session, _, _ = auth_context
    add_user(session, role="admin", email="admin@example.com")
    target = add_user(session, role="client", email="client@example.com")
    headers = bearer_headers(sign_in(client, "admin@example.com"))

    def set_role(role):
        response = client.patch(
            f"/admin/users/{target.id}/role", headers=headers, json={"role": role}
        )
        assert response.status_code == 200

    set_role("agent")
    profile = session.get(AgentProfile, target.id)
    assert profile.display_name == PLACEHOLDER_DISPLAY_NAME
    code = profile.referral_code

    set_role("client")
    set_role("agent")
    session.expire_all()
    assert session.get(AgentProfile, target.id).referral_code == code
