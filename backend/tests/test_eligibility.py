"""v1.2.0 commission eligibility: the mapping, the admin report, and the
client view (own registrations only, pending only as a total)."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from test_auth import auth_context  # noqa: F401
from test_domain_tables import make_customer
from test_phase4_api import add_scored_customer, api  # noqa: F401
from test_pipeline import TRANSITIONS

from app.models import AgentProfile
from app.services.eligibility import eligibility, eligibility_counts
from app.services.periods import recent_months
from app.services.reviews import apply_review

EXPECTED = {
    "received": "pending",
    "clear": "eligible",
    "under_review": "pending",
    "verified": "eligible",
    "rejected": "not_eligible",
}


@pytest.mark.parametrize(("status", "expected"), EXPECTED.items())
def test_eligibility_follows_registration_status(status, expected):
    assert eligibility(status) == expected
    assert {status for _, _, status in TRANSITIONS} == set(EXPECTED)


def add(session, admin, agent, outcome, when, **overrides):
    """One customer with a known outcome, registered at `when`."""
    if outcome == "received":
        return make_customer(
            session,
            agent,
            email=f"{uuid4()}@example.test",
            created_at=when,
            **overrides,
        )
    customer, assessment = add_scored_customer(
        session, agent, flagged=outcome != "clear", created_at=when, **overrides
    )
    if outcome in ("confirmed_real", "confirmed_fake"):
        apply_review(session, None, admin, assessment, outcome, None)
    session.commit()
    return customer


@pytest.fixture
def dataset(api):  # noqa: F811
    """Agent: 2 clear + 1 under review this month, 1 verified + 1 rejected last
    month, and 1 rejected 13 months ago (outside the 12 months). Other agent:
    nothing. All registered for the client."""
    client, session, users, headers = api
    months = recent_months(datetime.now(UTC).date(), 12)
    this_month = datetime.combine(months[-1], datetime.min.time(), UTC)
    last_month = datetime.combine(months[-2], datetime.min.time(), UTC)
    long_ago = datetime.combine(months[0], datetime.min.time(), UTC) - timedelta(
        days=20
    )
    admin, agent = users["admin"], users["agent"]
    for profile in session.query(AgentProfile):
        profile.client_id = users["client"].id
    session.commit()
    mine = {"client_id": users["client"].id}
    for outcome, when in [
        ("clear", this_month + timedelta(hours=1)),
        ("clear", this_month + timedelta(hours=2)),
        ("under_review", this_month + timedelta(hours=3)),
        ("confirmed_real", last_month + timedelta(days=3)),
        ("confirmed_fake", last_month + timedelta(days=4)),
        ("confirmed_fake", long_ago),
    ]:
        add(session, admin, agent, outcome, when, **mine)
    return client, session, users, headers, months


def test_counts_per_agent_and_month(dataset):
    _, session, users, _, months = dataset
    counts = eligibility_counts(session)[users["agent"].id]
    assert vars(counts.totals) == {"eligible": 3, "pending": 1, "not_eligible": 2}
    assert vars(counts.by_month[months[-1]]) == {
        "eligible": 2,
        "pending": 1,
        "not_eligible": 0,
    }
    assert vars(counts.by_month[months[-2]]) == {
        "eligible": 1,
        "pending": 0,
        "not_eligible": 1,
    }
    assert users["other_agent"].id not in eligibility_counts(session)


def test_unscored_registration_is_pending(api):  # noqa: F811
    _, session, users, _ = api
    add(session, users["admin"], users["agent"], "received", datetime.now(UTC))
    totals = eligibility_counts(session)[users["agent"].id].totals
    assert vars(totals) == {"eligible": 0, "pending": 1, "not_eligible": 0}


def test_admin_report_per_agent_and_month(dataset):
    client, _, users, headers, months = dataset
    response = client.get("/admin/eligibility", headers=headers["admin"])
    assert response.status_code == 200
    body = response.json()

    assert body["totals"] == {"eligible": 3, "pending": 1, "not_eligible": 2}
    assert [row["month"] for row in body["months"]] == [
        start.strftime("%Y-%m") for start in months
    ]
    assert body["months"][-1] == {
        "month": months[-1].strftime("%Y-%m"),
        "eligible": 2,
        "pending": 1,
        "not_eligible": 0,
    }
    assert body["months"][-2]["eligible"] == body["months"][-2]["not_eligible"] == 1
    # The registration from 13 months ago counts in the totals only.
    assert sum(row["not_eligible"] for row in body["months"]) == 1
    kinds = ("eligible", "pending", "not_eligible")
    assert all(sum(row[kind] for kind in kinds) == 0 for row in body["months"][:-2])

    by_name = {row["agent"]["display_name"]: row for row in body["agents"]}
    assert list(by_name) == ["Amina Otieno", "Brian Mwangi"]
    assert by_name["Amina Otieno"]["totals"] == body["totals"]
    assert by_name["Brian Mwangi"]["totals"] == {
        "eligible": 0,
        "pending": 0,
        "not_eligible": 0,
    }
    assert len(by_name["Brian Mwangi"]["months"]) == 12


def test_agent_detail_shows_eligibility_per_customer(dataset):
    client, _, users, headers, _ = dataset
    detail = client.get(
        f"/admin/agents/{users['agent'].id}", headers=headers["admin"]
    ).json()
    pairs = sorted(
        (row["registration_status"], row["eligibility"]) for row in detail["customers"]
    )
    assert pairs == [
        ("clear", "eligible"),
        ("clear", "eligible"),
        ("rejected", "not_eligible"),
        ("rejected", "not_eligible"),
        ("under_review", "pending"),
        ("verified", "eligible"),
    ]


@pytest.mark.parametrize("role", ["agent", "client"])
def test_only_admins_see_the_eligibility_report(api, role):  # noqa: F811
    client, _, _, headers = api
    assert client.get("/admin/eligibility", headers=headers[role]).status_code == 403
    assert client.get("/admin/eligibility").status_code == 401


def test_client_sees_own_registrations_with_pending_only_as_total(dataset):
    client, session, users, headers, _ = dataset
    # The agent later moves to the rival client and registers a customer there;
    # neither the move nor that registration changes the first client's counts.
    session.get(AgentProfile, users["agent"].id).client_id = users["other_client"].id
    session.commit()
    add(
        session,
        users["admin"],
        users["agent"],
        "clear",
        datetime.now(UTC),
        client_id=users["other_client"].id,
    )

    response = client.get("/client/eligibility", headers=headers["client"])

    assert response.status_code == 200
    body = response.json()
    assert (body["eligible"], body["pending"], body["not_eligible"]) == (3, 1, 2)
    assert body["agents"] == [
        # Still listed: these registrations were made for this client.
        {"display_name": "Amina Otieno", "eligible": 3, "not_eligible": 2},
        # Assigned to this client, nothing registered yet.
        {"display_name": "Brian Mwangi", "eligible": 0, "not_eligible": 0},
    ]
    for word in ("pending", "flag", "review", "probability", "score"):
        assert word not in str(body["agents"]).lower()

    rival = client.get("/client/eligibility", headers=headers["other_client"]).json()
    assert (rival["eligible"], rival["pending"], rival["not_eligible"]) == (1, 0, 0)
    assert [row["display_name"] for row in rival["agents"]] == ["Amina Otieno"]


@pytest.mark.parametrize("role", ["admin", "agent"])
def test_only_clients_see_client_eligibility(api, role):  # noqa: F811
    client, _, _, headers = api
    assert client.get("/client/eligibility", headers=headers[role]).status_code == 403
    assert client.get("/client/eligibility").status_code == 401
