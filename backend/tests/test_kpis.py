"""v1.2.0 KPI tracking: monthly KPIs and reputation as of a past date on a
small fixed dataset with hand-calculated expected values.

The dataset (one agent, "now" = 2026-10-15 12:00 UTC, p0 = 0.0539, k = 10):

    id  registered (UTC)   flagged  review (UTC)      decision
    A1  2026-08-03 10:00   no       -                 -
    A2  2026-08-10 10:00   no       -                 -
    A3  2026-08-12 10:00   yes      2026-08-14 10:00  confirmed_fake  (48 h)
    A4  2026-08-20 10:00   yes      2026-09-02 10:00  confirmed_real  (312 h)
    S1  2026-09-05 10:00   no       -                 -
    S2  2026-09-09 10:00   yes      2026-09-10 10:00  confirmed_fake  (24 h)
    S3  2026-09-25 10:00   yes      -                 (pending)
    O1  2026-10-01 10:00   no       -                 -
    O2  2026-10-02 10:00   no       -                 -
    O3  2026-10-05 10:00   yes      2026-10-06 10:00  confirmed_real  (24 h)
    O4  2026-10-10 10:00   no       2026-10-12 10:00  confirmed_fake  (48 h)

O4 was not flagged but an admin confirmed it as fake; it counts as a flag,
as it does in the live reputation (status rejected).
"""

from datetime import UTC, date, datetime, timedelta

import pytest
from test_auth import auth_context  # noqa: F401
from test_domain_tables import make_assessment, make_customer
from test_phase4_api import api  # noqa: F401

from app.models import ScoringConfig
from app.services.kpis import Registration, load_registrations, monthly_kpis
from app.services.periods import recent_months
from app.services.reputation import agent_reputations, reputation_score
from app.services.reviews import apply_review

NOW = datetime(2026, 10, 15, 12, tzinfo=UTC)
CONFIG = ScoringConfig(p0=0.0539, k=10, min_users_for_band=30)


def at(month, day, hour=10):
    return datetime(2026, month, day, hour, tzinfo=UTC)


# (registered, flagged, reviewed_at, decision)
DATASET = [
    (at(8, 3), False, None, None),
    (at(8, 10), False, None, None),
    (at(8, 12), True, at(8, 14), "confirmed_fake"),
    (at(8, 20), True, at(9, 2), "confirmed_real"),
    (at(9, 5), False, None, None),
    (at(9, 9), True, at(9, 10), "confirmed_fake"),
    (at(9, 25), True, None, None),
    (at(10, 1), False, None, None),
    (at(10, 2), False, None, None),
    (at(10, 5), True, at(10, 6), "confirmed_real"),
    (at(10, 10), False, at(10, 12), "confirmed_fake"),
]

# Hand-calculated. reputation = 100 * (1 - (flags + 10 * 0.0539) / (n + 10)).
EXPECTED = {
    "2026-08": dict(
        registrations=4,
        flagged=2,
        confirmed_fake=1,
        reviewed=2,
        confirmed_real=1,
        eligible=3,
        flag_rate=0.5,
        confirmed_fake_rate=0.25,
        verification_rate=0.5,
        avg_hours_to_review=180.0,
        # End of August: A3 confirmed fake; A4 still waiting (reviewed 2 Sep).
        n_users_to_date=4,
        reputation=81.9,  # 100*(1-(2+0.539)/14)
    ),
    "2026-09": dict(
        registrations=3,
        flagged=2,
        confirmed_fake=1,
        reviewed=1,
        confirmed_real=0,
        eligible=1,
        flag_rate=0.6667,
        confirmed_fake_rate=0.3333,
        verification_rate=0.0,
        avg_hours_to_review=24.0,
        # End of September: A3, S2 fake, S3 pending; A4 now confirmed real.
        n_users_to_date=7,
        reputation=79.2,  # 100*(1-(3+0.539)/17)
    ),
    "2026-10": dict(
        registrations=4,
        flagged=1,
        confirmed_fake=1,
        reviewed=2,
        confirmed_real=1,
        eligible=3,
        flag_rate=0.25,
        confirmed_fake_rate=0.25,
        verification_rate=0.5,
        avg_hours_to_review=36.0,
        # Now: A3, S2, O4 fake and S3 pending; O3 confirmed real.
        n_users_to_date=11,
        reputation=78.4,  # 100*(1-(4+0.539)/21)
    ),
}
EMPTY = dict(
    registrations=0,
    flagged=0,
    confirmed_fake=0,
    reviewed=0,
    confirmed_real=0,
    eligible=0,
    flag_rate=None,
    confirmed_fake_rate=None,
    verification_rate=None,
    avg_hours_to_review=None,
    n_users_to_date=0,
    reputation=None,
)


def registrations(agent_id, shift=timedelta(0)):
    return [
        Registration(
            agent_id=agent_id,
            registered_at=registered + shift,
            scored_at=registered + shift,
            flagged=flagged,
            reviewed_at=reviewed + shift if reviewed else None,
            decision=decision,
        )
        for registered, flagged, reviewed, decision in DATASET
    ]


def as_dict(row):
    values = dict(vars(row))
    return values.pop("month").strftime("%Y-%m"), values


def test_monthly_kpis_on_the_fixed_dataset():
    months = recent_months(NOW.date(), 12)
    rows = dict(map(as_dict, monthly_kpis(registrations(None), months, NOW, CONFIG)))

    assert list(rows) == [start.strftime("%Y-%m") for start in months]
    for month, expected in EXPECTED.items():
        assert rows[month] == expected, month
    # Months before the first registration are honest blanks, not zeros %.
    for month in list(rows)[:-3]:
        assert rows[month] == EMPTY, month


def test_hand_calculated_reputations():
    assert reputation_score(4, 2, 10, 0.0539) == 81.9
    assert reputation_score(7, 3, 10, 0.0539) == 79.2
    assert reputation_score(11, 4, 10, 0.0539) == 78.4


def test_reputation_as_of_uses_only_what_was_known_then():
    """A4 counts as a flag at the end of August but not after its review."""
    months = [date(2026, 8, 1), date(2026, 9, 1)]
    august, september = monthly_kpis(registrations(None), months, NOW, CONFIG)
    assert august.reputation == reputation_score(4, 2, 10, 0.0539)
    assert september.reputation == reputation_score(7, 3, 10, 0.0539)


def test_registration_on_a_month_boundary_belongs_to_the_new_month():
    rows = [
        Registration(None, datetime(2026, 9, 1, tzinfo=UTC), None, None, None, None)
    ]
    august, september = monthly_kpis(
        rows, [date(2026, 8, 1), date(2026, 9, 1)], NOW, CONFIG
    )
    assert (august.registrations, september.registrations) == (0, 1)
    # Not scored yet: counted as a customer but not as a flag.
    assert september.reputation == reputation_score(1, 0, 10, 0.0539)


def seed(session, admin, agent, shift):
    """Store the dataset, moved by `shift` so that it ends near today."""
    for registered, flagged, reviewed, decision in DATASET:
        when = registered + shift
        customer = make_customer(
            session,
            agent,
            email=f"{when.timestamp()}@example.test",
            created_at=when,
            status="pending_review" if flagged else "verified",
        )
        assessment = make_assessment(
            session, customer, flagged=flagged, created_at=when
        )
        if decision:
            review = apply_review(session, None, admin, assessment, decision, None)
            review.created_at = reviewed + shift
    session.commit()


@pytest.fixture
def stored(api):  # noqa: F811
    client, session, users, headers = api
    # Move the dataset so that "now" (15 Oct 12:00) is a few minutes ago.
    shift = datetime.now(UTC) - timedelta(minutes=5) - NOW
    seed(session, users["admin"], users["agent"], shift)
    return client, session, users, headers, shift


def test_stored_registrations_load_as_in_the_dataset(stored):
    _, session, users, _, shift = stored
    loaded = sorted(
        load_registrations(session, [users["agent"].id]),
        key=lambda row: row.registered_at,
    )
    assert loaded == registrations(users["agent"].id, shift)


def test_current_month_reputation_equals_live_reputation(stored):
    """Reputation at the end of the current month (as of now) must equal the
    live, status-based reputation of the agent ranking."""
    client, session, users, headers, _ = stored
    agent_id = users["agent"].id

    response = client.get(f"/admin/agents/{agent_id}/kpis", headers=headers["admin"])

    assert response.status_code == 200
    months = response.json()["months"]
    assert len(months) == 12
    live = agent_reputations(session, session.get(ScoringConfig, 1), [agent_id])
    detail = client.get(f"/admin/agents/{agent_id}", headers=headers["admin"]).json()
    assert months[-1]["reputation"] == live[agent_id].reputation == 78.4
    assert months[-1]["reputation"] == detail["reputation"]
    assert months[-1]["n_users_to_date"] == detail["n_users"] == 11


def test_network_kpis_and_flag_rate_benchmark(stored):
    client, session, users, headers, shift = stored
    # The other agent: two clear registrations this month.
    for minutes in (1, 2):
        when = datetime.now(UTC) - timedelta(minutes=minutes)
        customer = make_customer(
            session,
            users["other_agent"],
            email=f"b{minutes}@example.test",
            created_at=when,
        )
        make_assessment(session, customer, flagged=False, created_at=when)
    session.commit()

    response = client.get("/admin/kpis", headers=headers["admin"])

    assert response.status_code == 200
    body = response.json()
    assert len(body["months"]) == 12
    assert sum(month["registrations"] for month in body["months"]) == 13
    assert "reputation" not in body["months"][0]
    # 5 flagged out of 13 registrations in the 12 months.
    assert body["network_flag_rate"] == round(5 / 13, 4)
    assert body["min_registrations"] == 30
    rows = {row["agent"]["display_name"]: row for row in body["benchmark"]}
    assert rows["Amina Otieno"] == {
        "agent": {"id": str(users["agent"].id), "display_name": "Amina Otieno"},
        "registrations": 11,
        "flag_rate": round(5 / 11, 4),
        "difference": round(round(5 / 11, 4) - round(5 / 13, 4), 4),
        "enough_data": False,
    }
    assert rows["Brian Mwangi"]["flag_rate"] == 0.0
    assert rows["Brian Mwangi"]["difference"] == -round(5 / 13, 4)
    # Higher above the network rate comes first.
    assert [row["agent"]["display_name"] for row in body["benchmark"]] == [
        "Amina Otieno",
        "Brian Mwangi",
    ]


def test_agent_without_registrations_has_honest_blanks(api):  # noqa: F811
    client, _, users, headers = api
    months = client.get(
        f"/admin/agents/{users['agent'].id}/kpis", headers=headers["admin"]
    ).json()["months"]
    assert all(month["reputation"] is None for month in months)
    assert all(month["flag_rate"] is None for month in months)
    network = client.get("/admin/kpis", headers=headers["admin"]).json()
    assert network["network_flag_rate"] is None
    assert all(row["flag_rate"] is None for row in network["benchmark"])


def test_unknown_agent_is_404(api):  # noqa: F811
    client, _, users, headers = api
    url = f"/admin/agents/{users['client'].id}/kpis"
    assert client.get(url, headers=headers["admin"]).status_code == 404


@pytest.mark.parametrize("role", ["agent", "client"])
def test_only_admins_see_kpis(api, role):  # noqa: F811
    client, _, users, headers = api
    for url in (f"/admin/agents/{users['agent'].id}/kpis", "/admin/kpis"):
        assert client.get(url, headers=headers[role]).status_code == 403
        assert client.get(url).status_code == 401
