import random
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest
from model_fixtures import tiny_state
from sqlalchemy import func, select
from test_domain_tables import make_customer, make_user

from app.demo import (
    ADMIN_EMAIL,
    REVIEW_NOTE,
    DemoPlan,
    DemoRow,
    assign_rows,
    is_demo_email,
    read_sample,
    reset_demo,
    seed_demo,
)
from app.ml.features import ASSISTED_UNKNOWN
from app.ml.model_service import ModelService, ModelUnavailableError
from app.models import AgentProfile, AuditLog, Customer, Review, RiskAssessment, User

PASSWORD = "Demo-Password-2026!"
NOW = datetime(2026, 10, 15, 12, tzinfo=UTC)
ALWAYS_FLAG = 0.0
SMALL = DemoPlan(
    agents=6,
    fraudulent_agents=(2, 5),
    small_agents=(3,),
    clients=3,
    fraudulent_customers=10,
    honest_customers=(4, 6),
    small_customers=(1, 2),
    assisted_share=0.0,
    history_days=120,
    auto_review_after=timedelta(days=60),
)


@pytest.fixture(scope="module")
def sample():
    return read_sample()


def seed(session, sample, plan=SMALL, threshold=ALWAYS_FLAG, rows=None):
    return seed_demo(
        session,
        ModelService(tiny_state(threshold)),
        PASSWORD,
        rows=rows or sample,
        plan=plan,
        now=NOW,
    )


def count(session, model, *where):
    return session.scalar(select(func.count()).select_from(model).where(*where))


def test_sample_has_features_and_labels_but_no_age(sample):
    assert len(sample) == 5000
    assert sum(row.fraud_bool for row in sample) == 300
    assert "customer_age" not in sample[0].features
    assert len(sample[0].features) == 13


def test_fraudulent_agents_get_forty_percent_fraud_rows(sample):
    assigned = assign_rows(sample, DemoPlan(), random.Random(1))
    for number in DemoPlan().fraudulent_agents:
        rows = assigned[number]
        assert len(rows) == 100
        assert sum(row.fraud_bool for row in rows) == 40
    for number in DemoPlan().small_agents:
        assert len(assigned[number]) < 30
    assert len(assigned) == 40


def test_demo_users_are_verified_approved_active(db_session, sample):
    summary = seed(db_session, sample)

    assert summary.created
    users = db_session.scalars(select(User).where(User.email.like("%@demo.%"))).all()
    assert len(users) == 1 + 3 + 6
    for user in users:
        assert is_demo_email(user.email)
        assert user.status == "approved"
        assert user.is_active
        assert user.email_verified_at is not None
    roles = {user.email: user.role for user in users}
    assert roles[ADMIN_EMAIL] == "admin"
    assert sorted(roles.values()).count("client") == 3


def test_agents_are_spread_over_three_clients(db_session, sample):
    seed(db_session, sample)
    client_ids = db_session.scalars(select(AgentProfile.client_id)).all()
    assert len(set(client_ids)) == 3
    assert None not in client_ids


def test_every_customer_is_scored_without_storing_the_label(db_session, sample):
    summary = seed(db_session, sample)
    customers = count(db_session, Customer)
    assert customers == summary.customers > 0
    assert count(db_session, RiskAssessment) == customers
    for features in db_session.scalars(select(RiskAssessment.features)):
        assert "fraud_bool" not in features
        assert "customer_age" not in features


def test_old_flags_are_reviewed_and_recent_flags_stay_pending(db_session, sample):
    summary = seed(db_session, sample)
    cutoff = NOW - SMALL.auto_review_after
    rows = db_session.execute(
        select(Customer, Review)
        .join(RiskAssessment, RiskAssessment.customer_id == Customer.id)
        .outerjoin(Review, Review.assessment_id == RiskAssessment.id)
    ).all()

    old = [
        (customer, review) for customer, review in rows if customer.created_at < cutoff
    ]
    recent = [
        (customer, review) for customer, review in rows if customer.created_at >= cutoff
    ]
    assert old and recent
    admin = db_session.scalar(select(User).where(User.email == ADMIN_EMAIL))
    for customer, review in old:
        assert review is not None
        assert review.reviewer_id == admin.id
        assert review.notes == REVIEW_NOTE
        expected = "rejected" if review.decision == "confirmed_fake" else "verified"
        assert customer.status == expected
    for customer, review in recent:
        assert review is None
        assert customer.status == "pending_review"
    assert summary.pending == len(recent)
    assert sum(summary.reviewed.values()) == len(old)
    # Reviews go through the same service as the API, so they are audited.
    assert count(db_session, AuditLog, AuditLog.action == "assessment_reviewed") == len(
        old
    )


@pytest.mark.parametrize(
    ("label", "decision"), [(1, "confirmed_fake"), (0, "confirmed_real")]
)
def test_automatic_reviews_follow_the_dataset_label(
    db_session, sample, label, decision
):
    rows = [DemoRow(features=sample[0].features, fraud_bool=label)] * 40
    plan = replace(SMALL, fraudulent_agents=(), small_agents=())
    seed(db_session, sample, plan=plan, rows=rows)
    decisions = set(db_session.scalars(select(Review.decision)))
    assert decisions == {decision}


def test_assisted_demo_customers_hide_device_features(db_session, sample):
    seed(db_session, sample, plan=replace(SMALL, assisted_share=1.0))
    assert count(db_session, Customer, Customer.assisted.is_(False)) == 0
    for features in db_session.scalars(select(RiskAssessment.features)):
        for name in ASSISTED_UNKNOWN:
            assert features[name] is None


def test_seed_is_safe_to_run_twice(db_session, sample):
    first = seed(db_session, sample)
    users = count(db_session, User)
    customers = count(db_session, Customer)

    second = seed(db_session, sample)

    assert first.created and not second.created
    assert count(db_session, User) == users
    assert count(db_session, Customer) == customers


def test_seed_refuses_without_a_ready_model(db_session, sample):
    with pytest.raises(ModelUnavailableError):
        seed_demo(db_session, ModelService(), PASSWORD, rows=sample, plan=SMALL)
    assert count(db_session, User) == 0


def test_seed_refuses_a_weak_password(db_session, sample):
    with pytest.raises(ValueError):
        seed_demo(
            db_session, ModelService(tiny_state()), "weak", rows=sample, plan=SMALL
        )


def test_reset_removes_only_demo_data(db_session, sample):
    real_agent = make_user(db_session)
    real_customer = make_customer(db_session, real_agent)
    db_session.commit()
    seed(db_session, sample)
    demo_client = db_session.scalar(
        select(User).where(User.email == "client1@demo.salesmesh.test")
    )
    real_profile = AgentProfile(
        user_id=real_agent.id,
        referral_code="AGT-ABCDEFGH",
        display_name="Real Agent",
        client_id=demo_client.id,
    )
    db_session.add(real_profile)
    db_session.commit()

    removed = reset_demo(db_session)

    assert removed["users"] == 1 + 3 + 6
    assert removed["customers"] > 0
    db_session.expire_all()
    assert count(db_session, User, User.email.like("%@demo.salesmesh.test")) == 0
    assert count(db_session, Review) == 0
    assert db_session.get(User, real_agent.id) is not None
    assert db_session.get(Customer, real_customer.id) is not None
    # A real agent who worked for a demo client is simply unassigned.
    assert db_session.get(AgentProfile, real_agent.id).client_id is None
    # A reset can be followed by a fresh seed.
    assert seed(db_session, sample).created
