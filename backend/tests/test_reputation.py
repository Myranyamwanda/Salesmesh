import pytest
from test_domain_tables import make_customer, make_user

from app.models import ScoringConfig
from app.services.agents import create_agent_profile
from app.services.reputation import (
    INSUFFICIENT_DATA,
    agent_reputations,
    reputation_score,
    risk_band,
)

CONFIG = ScoringConfig(
    p0=0.0539, k=10, min_users_for_band=30, high_risk_below=90, watch_below=92
)


def test_worked_example():
    # 100 * (1 - (11 + 10 * 0.0539) / (200 + 10)) = 94.505...
    assert reputation_score(200, 11, k=10, p0=0.0539) == 94.5


def test_new_agent_starts_at_the_platform_rate():
    assert reputation_score(0, 0, k=10, p0=0.0539) == 94.6


def test_more_flags_lower_the_score():
    scores = [reputation_score(100, flags, 10, 0.0539) for flags in (0, 5, 20, 100)]
    assert scores == sorted(scores, reverse=True)
    assert reputation_score(100, 100, 10, 0.0539) == pytest.approx(8.6)


def test_smoothing_protects_small_agents():
    # One flag out of two users is not treated as a 50% fraud rate.
    assert reputation_score(2, 1, 10, 0.0539) == 87.2


@pytest.mark.parametrize(
    ("n_users", "reputation", "band"),
    [
        (29, 50.0, INSUFFICIENT_DATA),
        (30, 89.9, "High risk"),
        (30, 90.0, "Watch"),
        (30, 91.9, "Watch"),
        (30, 92.0, "Low risk"),
        (500, 99.0, "Low risk"),
    ],
)
def test_risk_band_boundaries(n_users, reputation, band):
    assert risk_band(n_users, reputation, CONFIG) == band


def add_customers(session, agent, statuses, assisted=0):
    for index, status in enumerate(statuses):
        make_customer(
            session,
            agent,
            email=f"{agent.id}-{index}@example.test",
            status=status,
            assisted=index < assisted,
        )


def test_agent_reputations_count_flags_from_status(db_session):
    config = db_session.get(ScoringConfig, 1)
    busy = make_user(db_session)
    idle = make_user(db_session)
    for agent in (busy, idle):
        create_agent_profile(db_session, agent)
    statuses = ["verified"] * 26 + ["pending_review"] * 2 + ["rejected"] * 2
    add_customers(db_session, busy, statuses, assisted=6)
    db_session.flush()

    results = agent_reputations(db_session, config)

    stats = results[busy.id]
    assert (stats.n_users, stats.flags, stats.confirmed_fake, stats.pending_review) == (
        30,
        4,
        2,
        2,
    )
    assert stats.assisted_share == 0.2
    # 100 * (1 - (4 + 0.539) / 40) = 88.65
    assert stats.reputation == reputation_score(30, 4, config.k, config.p0) == 88.7
    assert stats.risk_score == 11.3
    assert stats.band == "High risk"
    assert results[idle.id].n_users == 0
    assert results[idle.id].band == INSUFFICIENT_DATA
    assert results[idle.id].assisted_share == 0.0


def test_agent_reputations_can_be_limited_to_some_agents(db_session):
    config = db_session.get(ScoringConfig, 1)
    first, second = make_user(db_session), make_user(db_session)
    for agent in (first, second):
        create_agent_profile(db_session, agent)
    db_session.flush()
    assert set(agent_reputations(db_session, config, [first.id])) == {first.id}
