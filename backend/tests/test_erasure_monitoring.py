from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from test_auth import auth_context  # noqa: F401
from test_phase4_api import add_scored_customer, api  # noqa: F401

from app.models import AuditLog, Customer, Review, RiskAssessment, ScoringConfig
from app.services.periods import recent_months

# --- Customer data erasure -------------------------------------------------------


def count(session, model, *where):
    return session.scalar(select(func.count()).select_from(model).where(*where))


def reviewed_customer(client, session, users, headers):
    customer, assessment = add_scored_customer(session, users["agent"])
    client.post(
        f"/admin/assessments/{assessment.id}/review",
        headers=headers["admin"],
        json={"decision": "confirmed_fake", "notes": "Checked"},
    )
    return customer, assessment


def erase(client, headers, customer_id, email):
    return client.post(
        f"/admin/customers/{customer_id}/erase",
        headers=headers,
        json={"confirm_email": email},
    )


def test_admin_erases_customer_assessments_and_reviews(api):  # noqa: F811
    client, session, users, headers = api
    customer, assessment = reviewed_customer(client, session, users, headers)
    keep, _ = add_scored_customer(session, users["agent"], flagged=False)
    customer_id, assessment_id, keep_id = customer.id, assessment.id, keep.id
    before = client.get(f"/admin/agents/{users['agent'].id}", headers=headers["admin"])

    response = erase(client, headers["admin"], customer_id, customer.email.upper())

    assert response.status_code == 204
    session.expire_all()
    assert session.get(Customer, customer_id) is None
    assert session.get(RiskAssessment, assessment_id) is None
    assert count(session, Review, Review.assessment_id == assessment_id) == 0
    assert session.get(Customer, keep_id) is not None
    # Reputation is calculated on read, so the erased customer is gone at once.
    after = client.get(f"/admin/agents/{users['agent'].id}", headers=headers["admin"])
    assert after.json()["n_users"] == before.json()["n_users"] - 1
    assert after.json()["confirmed_fake"] == before.json()["confirmed_fake"] - 1


def test_erasure_is_audited_without_personal_data(api):  # noqa: F811
    client, session, users, headers = api
    customer, _ = reviewed_customer(client, session, users, headers)
    personal = [
        customer.full_name,
        customer.email,
        customer.mobile_phone,
        customer.date_of_birth.isoformat(),
    ]
    customer_id = customer.id

    erase(client, headers["admin"], customer_id, customer.email)

    entry = session.scalar(
        select(AuditLog).where(
            AuditLog.action == "customer_erased", AuditLog.outcome == "success"
        )
    )
    assert entry.subject == f"customer:{customer_id}"
    assert entry.actor_user_id == users["admin"].id
    assert entry.target_user_id == users["agent"].id
    stored = " ".join(
        str(getattr(entry, column.key)) for column in AuditLog.__table__.columns
    )
    for value in personal:
        assert value not in stored


def test_wrong_confirmation_email_erases_nothing(api):  # noqa: F811
    client, session, users, headers = api
    customer, _ = add_scored_customer(session, users["agent"])

    response = erase(client, headers["admin"], customer.id, "someone@else.test")

    assert response.status_code == 422
    session.expire_all()
    assert session.get(Customer, customer.id) is not None
    failure = session.scalar(
        select(AuditLog).where(AuditLog.action == "customer_erased")
    )
    assert failure.outcome == "failure"


def test_erasing_an_unknown_customer_is_404(api):  # noqa: F811
    client, _, _, headers = api
    assert erase(client, headers["admin"], uuid4(), "a@b.test").status_code == 404


@pytest.mark.parametrize("role", ["agent", "client"])
def test_only_admins_can_erase(api, role):  # noqa: F811
    client, session, users, headers = api
    customer, _ = add_scored_customer(session, users["agent"])
    assert erase(client, headers[role], customer.id, customer.email).status_code == 403
    assert erase(client, None, customer.id, customer.email).status_code == 401
    session.expire_all()
    assert session.get(Customer, customer.id) is not None


# --- Model monitoring ------------------------------------------------------------


def month_key(when):
    return when.strftime("%Y-%m")


def test_monitoring_reports_monthly_flag_rate_and_mean(api):  # noqa: F811
    client, session, users, headers = api
    now = datetime.now(UTC)
    last_month = recent_months(now.date(), 2)[0]
    old = datetime(last_month.year, last_month.month, 10, tzinfo=UTC)
    # This month: probabilities 0.01, 0.05, 0.09 with threshold 0.035 -> 2 of 3.
    for probability in (0.01, 0.05, 0.09):
        _, assessment = add_scored_customer(session, users["agent"])
        assessment.probability = probability
        assessment.threshold = 0.035
    # Last month: one assessment, not a model flag (the rule may still flag it).
    _, assessment = add_scored_customer(session, users["agent"], flagged=True)
    assessment.probability = 0.02
    assessment.threshold = 0.035
    assessment.created_at = old
    session.commit()

    body = client.get("/admin/model/monitoring", headers=headers["admin"]).json()

    assert body["p0"] == session.get(ScoringConfig, 1).p0 == 0.0539
    months = {month["month"]: month for month in body["months"]}
    assert len(body["months"]) == 12
    assert months[month_key(now)] == {
        "month": month_key(now),
        "assessments": 3,
        "flag_rate": round(2 / 3, 4),
        "mean_probability": 0.05,
    }
    # Counts model flags only, not the stored "flagged" (which includes rules).
    assert months[month_key(old)]["flag_rate"] == 0.0
    assert months[month_key(old)]["mean_probability"] == 0.02


def test_monitoring_leaves_empty_months_blank(api):  # noqa: F811
    client, _, _, headers = api
    body = client.get("/admin/model/monitoring", headers=headers["admin"]).json()
    assert all(month["assessments"] == 0 for month in body["months"])
    assert all(month["flag_rate"] is None for month in body["months"])
    assert all(month["mean_probability"] is None for month in body["months"])


def test_monitoring_follows_the_scoring_config(api):  # noqa: F811
    client, session, _, headers = api
    session.get(ScoringConfig, 1).p0 = 0.07
    session.commit()
    body = client.get("/admin/model/monitoring", headers=headers["admin"]).json()
    assert body["p0"] == 0.07


@pytest.mark.parametrize("role", ["agent", "client"])
def test_monitoring_is_admin_only(api, role):  # noqa: F811
    client, _, _, headers = api
    assert (
        client.get("/admin/model/monitoring", headers=headers[role]).status_code == 403
    )
    assert client.get("/admin/model/monitoring").status_code == 401


def test_months_older_than_a_year_are_not_shown(api):  # noqa: F811
    client, session, users, headers = api
    _, assessment = add_scored_customer(session, users["agent"])
    assessment.created_at = datetime.now(UTC) - timedelta(days=500)
    session.commit()
    body = client.get("/admin/model/monitoring", headers=headers["admin"]).json()
    assert sum(month["assessments"] for month in body["months"]) == 0
