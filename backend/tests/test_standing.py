"""v1.2.0 agent standing and activity: one label and monthly totals, never a
score, band, probability, reason, flag, or per-customer status."""

from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

import pytest
from test_auth import auth_context  # noqa: F401
from test_domain_tables import make_assessment, make_customer
from test_phase4_api import api  # noqa: F401

from app.models import RiskAssessment, ScoringConfig
from app.services.kpis import Registration
from app.services.reputation import agent_reputations, reputation_score
from app.services.reviews import apply_review
from app.services.standing import agent_activity, agent_standing, cutoff

NOW = datetime(2026, 10, 15, 12, tzinfo=UTC)
CONFIG = ScoringConfig(
    p0=0.0539, k=10, min_users_for_band=30, high_risk_below=90, watch_below=92
)
LAST_MONTH = datetime(2026, 9, 10, tzinfo=UTC)

# Words and fields an agent response must never contain. "review" is allowed
# in the standing label "Account under review" only.
FORBIDDEN_WORDS = (
    "reputation",
    "risk",
    "band",
    "score",
    "probability",
    "reason",
    "flag",
    "watch",
    "low",
    "high",
    "insufficient",
    "threshold",
    "feature",
)
ACTIVITY_FORBIDDEN = (*FORBIDDEN_WORDS, "review", "status", "rejected", "fake")
FORBIDDEN_FIELDS = {
    "reputation",
    "risk_score",
    "band",
    "n_users",
    "flags",
    "flagged",
    "probability",
    "reasons",
    "status",
    "registration_status",
    "pending_review",
    "confirmed_fake",
    "confirmed_real",
    "not_eligible",
}


def made(registered, flagged=False, reviewed=None, decision=None):
    return Registration(None, registered, registered, flagged, reviewed, decision)


def last_month(clear, flagged):
    return [made(LAST_MONTH) for _ in range(clear)] + [
        made(LAST_MONTH, flagged=True) for _ in range(flagged)
    ]


@pytest.mark.parametrize(
    ("registrations", "reputation", "standing"),
    [
        ([], None, "New agent"),
        # 29 registrations: below min_users_for_band (30).
        (last_month(29, 0), reputation_score(29, 0, 10, 0.0539), "New agent"),
        # 40 clear: 100 * (1 - 0.539 / 50) = 98.9 -> Low risk.
        (last_month(40, 0), 98.9, "Good standing"),
        # 4 flags: 100 * (1 - 4.539 / 50) = 90.9 -> Watch.
        (last_month(36, 4), 90.9, "Good standing"),
        # 5 flags: 100 * (1 - 5.539 / 50) = 88.9 -> High risk.
        (last_month(35, 5), 88.9, "Account under review"),
    ],
)
def test_standing_follows_the_internal_band(registrations, reputation, standing):
    flags = sum(r.flagged for r in registrations)
    if registrations:
        assert reputation_score(len(registrations), flags, 10, 0.0539) == reputation
    assert agent_standing(registrations, NOW, CONFIG) == standing


def test_standing_changes_only_at_the_start_of_a_month():
    registrations = last_month(40, 0)
    # Ten flags this month do not count until 1 November.
    this_month = [made(datetime(2026, 10, 2, tzinfo=UTC), True) for _ in range(10)]
    assert agent_standing(registrations + this_month, NOW, CONFIG) == "Good standing"
    november = datetime(2026, 11, 1, 1, tzinfo=UTC)
    assert (
        agent_standing(registrations + this_month, november, CONFIG)
        == "Account under review"
    )


def test_a_review_this_month_shows_next_month():
    flagged = [
        made(LAST_MONTH, True, datetime(2026, 10, 3, tzinfo=UTC), "confirmed_real")
        for _ in range(5)
    ]
    registrations = last_month(35, 0) + flagged
    assert agent_standing(registrations, NOW, CONFIG) == "Account under review"
    november = datetime(2026, 11, 1, 1, tzinfo=UTC)
    assert agent_standing(registrations, november, CONFIG) == "Good standing"


def test_activity_covers_completed_months_as_known_at_the_cutoff():
    registrations = [
        # September: 12 registrations, 2 flagged; one confirmed real on
        # 3 October, after the cutoff, so it still counts as awaiting.
        *[made(LAST_MONTH) for _ in range(10)],
        made(LAST_MONTH, True),
        made(LAST_MONTH, True, datetime(2026, 10, 3, tzinfo=UTC), "confirmed_real"),
        # August: 9 registrations, below 10, so totals only.
        *[made(datetime(2026, 8, 5, tzinfo=UTC)) for _ in range(9)],
        # This month: not shown at all.
        made(datetime(2026, 10, 2, tzinfo=UTC)),
    ]

    months = agent_activity(registrations, NOW)

    assert len(months) == 12
    assert (months[0].month, months[-1].month) == (date(2025, 10, 1), date(2026, 9, 1))
    september, august = months[-1], months[-2]
    assert (
        september.registrations,
        september.eligible,
        september.awaiting_verification,
    ) == (12, 10, 2)
    assert (august.registrations, august.eligible, august.awaiting_verification) == (
        9,
        None,
        None,
    )
    assert all(month.registrations == 0 for month in months[:-2])


def test_cutoff_is_the_start_of_the_month_in_utc():
    assert cutoff(NOW) == datetime(2026, 10, 1, tzinfo=UTC)


# --- API -------------------------------------------------------------------


@pytest.fixture
def high_risk_agent(api):  # noqa: F811
    """Last month: 35 clear and 5 flagged (pending) -> High risk (88.9).
    Two months ago: 3 clear registrations."""
    client, session, users, headers = api
    start = cutoff(datetime.now(UTC))
    last = start - timedelta(days=10)
    earlier = start - timedelta(days=40)
    for when, flagged in (
        [(last, False)] * 35 + [(last, True)] * 5 + [(earlier, False)] * 3
    ):
        customer = make_customer(
            session,
            users["agent"],
            email=f"{uuid4()}@example.test",
            created_at=when,
            status="pending_review" if flagged else "verified",
        )
        make_assessment(session, customer, flagged=flagged, created_at=when)
    session.commit()
    return client, session, users, headers


def check_private(response, words):
    text = response.text.lower()
    for word in words:
        assert word not in text, word


def all_keys(value):
    if isinstance(value, dict):
        return set(value) | {key for item in value.values() for key in all_keys(item)}
    if isinstance(value, list):
        return {key for item in value for key in all_keys(item)}
    return set()


def test_agent_standing_response_is_one_label(high_risk_agent):
    client, session, users, headers = high_risk_agent

    response = client.get("/me/standing", headers=headers["agent"])

    assert response.status_code == 200
    as_of = cutoff(datetime.now(UTC)).date().isoformat()
    assert response.json() == {"standing": "Account under review", "as_of": as_of}
    check_private(response, FORBIDDEN_WORDS)
    assert not all_keys(response.json()) & FORBIDDEN_FIELDS
    # The live reputation value does not appear either.
    live = agent_reputations(session, session.get(ScoringConfig, 1))
    assert str(live[users["agent"].id].reputation) not in response.text

    other = client.get("/me/standing", headers=headers["other_agent"]).json()
    assert other == {"standing": "New agent", "as_of": as_of}


def test_agent_activity_response_has_monthly_totals_only(high_risk_agent):
    client, session, users, headers = high_risk_agent
    # A review after the cutoff does not change the completed month's figures.
    pending = session.query(RiskAssessment).filter(RiskAssessment.flagged).first()
    apply_review(session, None, users["admin"], pending, "confirmed_real", None)
    session.commit()

    response = client.get("/me/activity", headers=headers["agent"])

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"as_of", "months"}
    assert len(body["months"]) == 12
    assert all(
        set(month) == {"month", "registrations", "eligible", "awaiting_verification"}
        for month in body["months"]
    )
    last, earlier = body["months"][-1], body["months"][-2]
    assert (last["registrations"], last["eligible"], last["awaiting_verification"]) == (
        40,
        35,
        5,
    )
    assert earlier == {
        "month": earlier["month"],
        "registrations": 3,
        "eligible": None,
        "awaiting_verification": None,
    }
    current_month = datetime.now(UTC).strftime("%Y-%m")
    assert current_month not in [month["month"] for month in body["months"]]
    check_private(response, ACTIVITY_FORBIDDEN)
    assert not all_keys(body) & FORBIDDEN_FIELDS


@pytest.mark.parametrize("role", ["admin", "client"])
def test_only_agents_see_standing_and_activity(api, role):  # noqa: F811
    client, _, _, headers = api
    for url in ("/me/standing", "/me/activity"):
        assert client.get(url, headers=headers[role]).status_code == 403
        assert client.get(url).status_code == 401
