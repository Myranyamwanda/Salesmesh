from datetime import date, timedelta
from uuid import uuid4

import pytest
from model_fixtures import tiny_state
from sqlalchemy import func, select
from test_auth import add_user, auth_context, bearer_headers, sign_in  # noqa: F401

from app.core.config import get_settings
from app.ml.features import ASSISTED_UNKNOWN, FEATURE_NAMES
from app.ml.model_service import ModelService
from app.models import Customer, RiskAssessment
from app.services.agents import create_agent_profile

NEVER_FLAG = 1.0
ALWAYS_FLAG = 0.0
WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0 Safari/537.36"


@pytest.fixture
def join(auth_context):  # noqa: F811
    client, session, _, settings = auth_context
    agent = add_user(session, role="agent", email="agent@example.com")
    profile = create_agent_profile(session, agent, "Amina Otieno")
    session.commit()
    use_model(client, NEVER_FLAG)
    return client, session, settings, agent, profile.referral_code


def use_model(client, threshold):
    client.app.state.model_service = ModelService(tiny_state(threshold))


def form(**overrides):
    values = {
        "full_name": "Wanjiru Kamau",
        "email": "Wanjiru.Kamau@gmail.com",
        "mobile_phone": "0712345678",
        "secondary_phone": "",
        "date_of_birth": "1995-05-17",
        "country": "ke",
        "current_address_months": 24,
        "previous_address_months": None,
        "keep_signed_in": True,
        "consent": True,
        "session_length_minutes": 4.5,
        "device_id": str(uuid4()),
        "user_agent": WINDOWS,
    }
    return values | overrides


def count(session, model):
    return session.scalar(select(func.count()).select_from(model))


def test_join_link_returns_display_name_only(join):
    client, _, _, _, code = join
    response = client.get(f"/join/{code}")
    assert response.status_code == 200
    assert response.json() == {"display_name": "Amina Otieno"}
    assert client.get(f"/join/{code.lower()}").status_code == 200


def make_inactive(session, agent, case):
    if case == "pending":
        agent.status = "pending"
    elif case == "deactivated":
        agent.is_active = False
    elif case == "role_changed":
        agent.role = "client"
    elif case == "unverified":
        agent.email_verified_at = None
    session.commit()


@pytest.mark.parametrize(
    "case", ["unknown_code", "pending", "deactivated", "role_changed", "unverified"]
)
def test_inactive_links_give_the_same_neutral_response(join, case):
    client, session, _, agent, code = join
    if case == "unknown_code":
        code = "AGT-ZZZZZZZZ"
    else:
        make_inactive(session, agent, case)

    for response in (
        client.get(f"/join/{code}"),
        client.post(f"/join/{code}/register", json=form()),
    ):
        assert response.status_code == 404
        error = response.json()["error"]
        assert (error["code"], error["message"]) == (
            "http_404",
            "This link is not active",
        )
    assert count(session, Customer) == 0


def test_registration_saves_customer_and_assessment(join):
    client, session, _, agent, code = join

    response = client.post(f"/join/{code}/register", json=form())

    assert response.status_code == 201
    assert response.json() == {"message": "Registration received"}
    customer = session.scalar(select(Customer))
    assert customer.agent_id == agent.id
    assert customer.email == "wanjiru.kamau@gmail.com"
    assert customer.country == "KE"
    assert customer.secondary_phone is None
    assert customer.assisted is False
    assert customer.status == "verified"
    assert customer.consent_at is not None
    assert len(customer.ip_address_hash) == 64
    assessment = session.scalar(select(RiskAssessment))
    assert assessment.customer_id == customer.id
    assert assessment.model_version == "test-tiny"
    assert assessment.flagged is False
    # JSONB does not keep key order; the model always uses metadata order.
    assert set(assessment.features) == set(FEATURE_NAMES)
    assert assessment.features["device_os"] == "windows"
    assert assessment.features["date_of_birth_distinct_emails_4w"] == 0
    assert assessment.features["name_email_similarity"] == 1.0


def test_flagged_registration_waits_for_review(join):
    client, session, _, _, code = join
    use_model(client, ALWAYS_FLAG)

    response = client.post(f"/join/{code}/register", json=form())

    assert response.json() == {"message": "Registration received"}
    assert session.scalar(select(Customer)).status == "pending_review"
    assessment = session.scalar(select(RiskAssessment))
    assert assessment.flagged is True
    assert assessment.threshold == ALWAYS_FLAG
    assert all(reason["source"] == "model" for reason in assessment.reasons)


def test_invalid_mobile_number_is_accepted_and_recorded(join):
    client, session, _, _, code = join
    response = client.post(f"/join/{code}/register", json=form(mobile_phone="123"))
    assert response.status_code == 201
    assert session.scalar(select(RiskAssessment)).features["phone_mobile_valid"] == 0


@pytest.mark.parametrize(
    "override",
    [
        {"consent": False},
        {"consent": None},
        {"date_of_birth": (date.today() + timedelta(days=1)).isoformat()},
        {"date_of_birth": "1899-12-31"},
        {"country": "XX"},
        {"country": "KEN"},
        {"current_address_months": -1},
        {"previous_address_months": -1},
        {"session_length_minutes": -1},
        {"email": "not-an-email"},
        {"full_name": " "},
        {"device_id": "not-a-uuid"},
    ],
)
def test_invalid_registrations_are_rejected(join, override):
    client, session, _, _, code = join
    payload = form(**override)
    if override.get("consent") is None and "consent" in override:
        del payload["consent"]
    response = client.post(f"/join/{code}/register", json=payload)
    assert response.status_code == 422
    assert count(session, Customer) == 0


def test_assisted_registration_by_the_agent(join):
    client, session, _, _, code = join
    headers = bearer_headers(sign_in(client))

    response = client.post(
        f"/join/{code}/register", headers=headers, json=form(assisted=True)
    )

    assert response.status_code == 201
    customer = session.scalar(select(Customer))
    assert customer.assisted is True
    features = session.scalar(select(RiskAssessment)).features
    for name in ASSISTED_UNKNOWN:
        assert features[name] is None


def test_assisted_registration_requires_the_owning_agent(join):
    client, session, _, _, code = join
    assert (
        client.post(f"/join/{code}/register", json=form(assisted=True)).status_code
        == 403
    )
    other = add_user(session, role="agent", email="other@example.com")
    create_agent_profile(session, other, "Other Agent")
    session.commit()
    headers = bearer_headers(sign_in(client, "other@example.com"))
    response = client.post(
        f"/join/{code}/register", headers=headers, json=form(assisted=True)
    )
    assert response.status_code == 403
    assert count(session, Customer) == 0


def test_invalid_token_on_public_endpoint_is_401(join):
    client, _, _, _, code = join
    response = client.post(
        f"/join/{code}/register",
        headers={"Authorization": "Bearer not-a-token"},
        json=form(),
    )
    assert response.status_code == 401


def test_registration_is_rate_limited_but_assisted_is_exempt(join):
    client, session, settings, _, code = join
    limited = settings.model_copy(update={"join_rate_limit": 2})
    client.app.dependency_overrides[get_settings] = lambda: limited

    statuses = [
        client.post(f"/join/{code}/register", json=form(email=f"c{i}@gmail.com"))
        for i in range(3)
    ]
    assert [response.status_code for response in statuses] == [201, 201, 429]
    assert statuses[2].headers["Retry-After"] == str(settings.join_rate_window_seconds)

    headers = bearer_headers(sign_in(client))
    response = client.post(
        f"/join/{code}/register", headers=headers, json=form(assisted=True)
    )
    assert response.status_code == 201
    assert count(session, Customer) == 3


def test_model_unavailable_saves_nothing(join):
    client, session, _, _, code = join
    client.app.state.model_service = ModelService()

    response = client.post(f"/join/{code}/register", json=form())

    assert response.status_code == 503
    assert count(session, Customer) == 0
    assert count(session, RiskAssessment) == 0


def test_registration_response_never_contains_scores(join):
    client, _, _, _, code = join
    use_model(client, ALWAYS_FLAG)
    response = client.post(f"/join/{code}/register", json=form())
    for word in ("probability", "flag", "reason", "pending", "score"):
        assert word not in response.text.lower()
