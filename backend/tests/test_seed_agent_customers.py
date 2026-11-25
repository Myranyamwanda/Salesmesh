"""seed-agent-customers: synthetic customers for one existing, real agent."""

import random
from datetime import timedelta

import pytest
from conftest import FakeFirebase
from model_fixtures import tiny_state
from sqlalchemy import func, select
from test_demo import ALWAYS_FLAG, NOW, PASSWORD, SETTINGS, SMALL, make_usable_admin
from test_domain_tables import make_customer, make_user

from app.demo import (
    DEMO_DOMAIN,
    SYNTHETIC_REVIEW_NOTE,
    clear_demo_data,
    read_sample,
    seed_agent_customers,
    seed_demo,
)
from app.ml.model_service import ModelService
from app.models import AgentProfile, Customer, Review, RiskAssessment, User
from app.services.agents import create_agent_profile

NEVER_FLAG = 1.0


@pytest.fixture(scope="module")
def sample():
    return read_sample()


def make_assigned_agent(session):
    """An approved, active agent working for an active client."""
    client = make_user(session, role="client")
    client.status = "approved"
    agent = make_user(session)
    agent.status = "approved"
    profile = create_agent_profile(session, agent, "Achieng Odhiambo")
    profile.client_id = client.id
    session.commit()
    return agent


def add_synthetic(session, sample, email, count=20, threshold=NEVER_FLAG, **options):
    return seed_agent_customers(
        session,
        ModelService(tiny_state(threshold)),
        email,
        count,
        rows=sample,
        now=NOW,
        rng=random.Random(7),
        **options,
    )


def customers_of(session, agent):
    return session.scalars(select(Customer).where(Customer.agent_id == agent.id)).all()


def test_refuses_an_unknown_email(db_session, sample):
    with pytest.raises(ValueError, match="No agent account"):
        add_synthetic(db_session, sample, "nobody@example.test")


def test_refuses_a_user_who_is_not_an_agent(db_session, sample):
    client = make_user(db_session, role="client")
    db_session.commit()
    with pytest.raises(ValueError, match="No agent account"):
        add_synthetic(db_session, sample, client.email)


def test_refuses_an_unapproved_agent(db_session, sample):
    agent = make_assigned_agent(db_session)
    agent.status = "pending"
    db_session.commit()
    with pytest.raises(ValueError, match="not an approved, active agent"):
        add_synthetic(db_session, sample, agent.email)


def test_refuses_a_deactivated_agent(db_session, sample):
    agent = make_assigned_agent(db_session)
    agent.is_active = False
    db_session.commit()
    with pytest.raises(ValueError, match="not an approved, active agent"):
        add_synthetic(db_session, sample, agent.email)


def test_refuses_an_agent_without_a_client(db_session, sample):
    agent = make_user(db_session)
    agent.status = "approved"
    create_agent_profile(db_session, agent, "Brian Otieno")
    db_session.commit()
    with pytest.raises(ValueError, match="not assigned to a client"):
        add_synthetic(db_session, sample, agent.email)


def test_refuses_an_agent_whose_client_is_inactive(db_session, sample):
    agent = make_assigned_agent(db_session)
    client = db_session.get(User, db_session.get(AgentProfile, agent.id).client_id)
    client.is_active = False
    db_session.commit()
    with pytest.raises(ValueError, match="client .* is not active"):
        add_synthetic(db_session, sample, agent.email)


@pytest.mark.parametrize(
    ("options", "message"),
    [
        ({"count": 0}, "--count"),
        ({"count": 1001}, "--count"),
        ({"months": 0}, "--months"),
        ({"profile": "unknown"}, "--profile"),
    ],
)
def test_refuses_invalid_options(db_session, sample, options, message):
    agent = make_assigned_agent(db_session)
    with pytest.raises(ValueError, match=message):
        add_synthetic(db_session, sample, agent.email, **options)


def test_creates_the_requested_number_of_scored_customers(db_session, sample):
    agent = make_assigned_agent(db_session)

    summary = add_synthetic(db_session, sample, agent.email, count=25, months=6)

    db_session.expire_all()
    customers = customers_of(db_session, agent)
    assert summary.customers == len(customers) == 25
    assert summary.n_users == 25
    assert summary.band
    for customer in customers:
        assert customer.email.endswith(f"@{DEMO_DOMAIN}")
        assert customer.client_id is not None
        assert NOW - timedelta(days=180) <= customer.created_at <= NOW
        # Own-device registrations each come from their own device.
        assert (customer.device_id is None) == customer.assisted
    assessments = db_session.scalar(
        select(func.count())
        .select_from(RiskAssessment)
        .join(Customer, Customer.id == RiskAssessment.customer_id)
        .where(Customer.agent_id == agent.id)
    )
    assert assessments == 25


def test_honest_customers_never_trigger_the_device_rule(db_session, sample):
    agent = make_assigned_agent(db_session)
    add_synthetic(db_session, sample, agent.email, count=60)

    reasons = db_session.scalars(
        select(RiskAssessment.reasons)
        .join(Customer, Customer.id == RiskAssessment.customer_id)
        .where(Customer.agent_id == agent.id)
    ).all()
    assert all(
        reason["source"] != "rule"
        for agent_reasons in reasons
        for reason in agent_reasons
    )


def test_old_flags_are_reviewed_by_the_demo_admin(db_session, sample):
    seed_demo(
        db_session,
        ModelService(tiny_state(NEVER_FLAG)),
        PASSWORD,
        FakeFirebase(),
        SETTINGS,
        rows=sample,
        plan=SMALL,
        now=NOW,
    )
    agent = make_assigned_agent(db_session)

    summary = add_synthetic(
        db_session,
        sample,
        agent.email,
        count=30,
        threshold=ALWAYS_FLAG,
        profile="fraudulent",
    )

    assert summary.reviewer
    # Assisted customers use the assisted threshold, so not every one is flagged.
    assert summary.flagged > 0
    to_review = summary.flagged + summary.audited
    assert sum(summary.reviewed.values()) + summary.pending == to_review
    assert sum(summary.reviewed.values()) > 0
    notes = db_session.scalars(
        select(Review.notes)
        .join(RiskAssessment, RiskAssessment.id == Review.assessment_id)
        .join(Customer, Customer.id == RiskAssessment.customer_id)
        .where(Customer.agent_id == agent.id)
    ).all()
    assert set(notes) == {SYNTHETIC_REVIEW_NOTE}


def test_without_a_demo_admin_flags_stay_pending(db_session, sample):
    agent = make_assigned_agent(db_session)

    summary = add_synthetic(
        db_session, sample, agent.email, count=10, threshold=ALWAYS_FLAG
    )

    assert not summary.reviewer
    assert summary.flagged > 0
    assert summary.pending == summary.flagged + summary.audited
    assert sum(summary.reviewed.values()) == 0


def test_other_agents_are_unchanged(db_session, sample):
    agent = make_assigned_agent(db_session)
    other = make_assigned_agent(db_session)
    real = make_customer(db_session, other, email="real@example.test")
    db_session.commit()

    add_synthetic(db_session, sample, agent.email, count=15)

    db_session.expire_all()
    assert [customer.id for customer in customers_of(db_session, other)] == [real.id]


def test_clear_demo_data_removes_synthetic_customers_only(db_session, sample):
    make_usable_admin(db_session)
    agent = make_assigned_agent(db_session)
    real = make_customer(db_session, agent, email="real@example.test")
    db_session.commit()
    add_synthetic(db_session, sample, agent.email, count=12)

    removed = clear_demo_data(db_session)

    assert removed["customers"] == 12
    db_session.expire_all()
    # The agent and their real customer stay.
    assert [customer.id for customer in customers_of(db_session, agent)] == [real.id]
