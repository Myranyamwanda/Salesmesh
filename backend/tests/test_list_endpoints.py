"""Server-side pagination, search, filters, and sorting of the admin lists."""

from uuid import uuid4

import pytest
from test_auth import add_user, auth_context  # noqa: F401
from test_phase4_api import add_scored_customer, api  # noqa: F401

from app.models import AgentProfile, AuditLog, ScoringConfig
from app.services.agents import create_agent_profile


def get(client, headers, path, **params):
    response = client.get(path, headers=headers["admin"], params=params)
    assert response.status_code == 200, response.text
    return response.json()


def names(body):
    return [row["display_name"] for row in body["items"]]


@pytest.fixture
def network(api):  # noqa: F811
    """Three agents: Amina 3 flags pending; Brian 1 clear; Chebet none, no client."""
    client, session, users, headers = api
    chebet = add_user(session, role="agent", email="chebet@example.com")
    create_agent_profile(session, chebet, "Chebet Kiprono")
    for profile in session.query(AgentProfile).filter(
        AgentProfile.user_id.in_([users["agent"].id, users["other_agent"].id])
    ):
        profile.client_id = users["client"].id
    session.commit()
    for _ in range(3):
        add_scored_customer(session, users["agent"])
    add_scored_customer(session, users["other_agent"], flagged=False)
    users["third_agent"] = chebet
    return client, session, users, headers


# --- GET /admin/agents --------------------------------------------------------


def test_agents_are_paged_with_a_total(network):
    client, _, _, headers = network
    first = get(client, headers, "/admin/agents", limit=2)
    second = get(client, headers, "/admin/agents", limit=2, offset=2)

    assert first["total"] == second["total"] == 3
    # Lowest reputation first: 3 flags, then no customers, then 1 clear one.
    assert names(first) + names(second) == [
        "Amina Otieno",
        "Chebet Kiprono",
        "Brian Mwangi",
    ]


def test_agents_search_matches_name_or_email_in_any_case(network):
    client, _, _, headers = network
    assert names(get(client, headers, "/admin/agents", q="amINA")) == ["Amina Otieno"]
    by_email = get(client, headers, "/admin/agents", q="chebet@")
    assert (names(by_email), by_email["total"]) == (["Chebet Kiprono"], 1)
    # % is a literal character, not a wildcard.
    assert get(client, headers, "/admin/agents", q="%")["total"] == 0


def test_agents_filters(network):
    client, session, _, headers = network
    # Bands need 30 customers by default; lower the minimum for this test.
    session.get(ScoringConfig, 1).min_users_for_band = 1
    session.commit()
    everyone = {row["display_name"]: row["band"] for row in network_items(network)}
    low = [name for name, band in everyone.items() if band == "Low risk"]

    assert names(get(client, headers, "/admin/agents", band="Low risk")) == low
    both = client.get(
        "/admin/agents?band=Low%20risk&band=High%20risk", headers=headers["admin"]
    ).json()
    assert both["total"] == sum(
        band in ("Low risk", "High risk") for band in everyone.values()
    )
    pending = get(client, headers, "/admin/agents", has_pending="true")
    assert names(pending) == ["Amina Otieno"]
    assert names(get(client, headers, "/admin/agents", no_client="true")) == [
        "Chebet Kiprono"
    ]


def network_items(network):
    client, _, _, headers = network
    return get(client, headers, "/admin/agents")["items"]


@pytest.mark.parametrize(
    ("sort", "direction", "expected"),
    [
        ("display_name", "asc", ["Amina Otieno", "Brian Mwangi", "Chebet Kiprono"]),
        ("display_name", "desc", ["Chebet Kiprono", "Brian Mwangi", "Amina Otieno"]),
        ("reputation", "desc", ["Brian Mwangi", "Chebet Kiprono", "Amina Otieno"]),
        ("n_users", "desc", ["Amina Otieno", "Brian Mwangi", "Chebet Kiprono"]),
        # Brian and Chebet tie on 0 flags, so name order decides, both ways.
        ("flags", "asc", ["Brian Mwangi", "Chebet Kiprono", "Amina Otieno"]),
        ("flags", "desc", ["Amina Otieno", "Brian Mwangi", "Chebet Kiprono"]),
    ],
)
def test_agents_sort(network, sort, direction, expected):
    client, _, _, headers = network
    body = get(client, headers, "/admin/agents", sort=sort, dir=direction)
    assert names(body) == expected


@pytest.mark.parametrize(
    "params",
    [{"sort": "email"}, {"dir": "up"}, {"limit": 101}, {"offset": -1}, {"band": "x"}],
)
def test_agents_reject_bad_parameters(network, params):
    client, _, _, headers = network
    response = client.get("/admin/agents", headers=headers["admin"], params=params)
    assert response.status_code == 422


def test_agents_list_is_admin_only(network):
    client, _, _, headers = network
    for role in ("agent", "client"):
        assert client.get("/admin/agents", headers=headers[role]).status_code == 403


# --- GET /admin/agents/{id}: customer search ----------------------------------


def test_agent_customers_search_by_name_or_reference(api):  # noqa: F811
    client, session, users, headers = api
    agent = users["agent"]
    kamau, _ = add_scored_customer(session, agent, full_name="Kamau Njoroge")
    add_scored_customer(session, agent, full_name="Achieng Odhiambo")
    path = f"/admin/agents/{agent.id}"

    assert get(client, headers, path)["customers_total"] == 2
    by_name = get(client, headers, path, q="kamau")
    assert [row["full_name"] for row in by_name["customers"]] == ["Kamau Njoroge"]
    assert by_name["customers_total"] == 1
    by_reference = get(client, headers, path, q=kamau.reference.lower())
    assert by_reference["customers_total"] == 1
    # The agent's own figures do not change with the search.
    assert by_reference["n_users"] == 2


# --- GET /admin/eligibility ---------------------------------------------------


def test_eligibility_pages_and_searches_agents(network):
    client, _, _, headers = network
    full = get(client, headers, "/admin/eligibility")
    page = get(client, headers, "/admin/eligibility", limit=1, offset=1)
    found = get(client, headers, "/admin/eligibility", q="chebet")

    assert full["agents_total"] == page["agents_total"] == 3
    assert [row["agent"]["display_name"] for row in page["agents"]] == ["Brian Mwangi"]
    assert found["agents_total"] == 1
    assert found["agents"][0]["agent"]["display_name"] == "Chebet Kiprono"
    # Network totals and months cover every agent, whatever the page.
    assert page["totals"] == found["totals"] == full["totals"]
    assert page["months"] == full["months"]


# --- GET /admin/users ---------------------------------------------------------


def emails(body):
    return sorted(row["email"] for row in body["items"])


def test_users_search_and_role_filter(api):  # noqa: F811
    client, _, _, headers = api
    found = get(client, headers, "/admin/users", q="RIVAL")
    assert (emails(found), found["total"]) == (["rival@example.com"], 1)
    clients = get(client, headers, "/admin/users", role="client")
    assert emails(clients) == ["client@example.com", "rival@example.com"]
    assert clients["total"] == 2


def test_users_status_filter_matches_the_admin_labels(api):  # noqa: F811
    client, session, _, headers = api
    add_user(session, email="pending@example.com", status="pending")
    add_user(session, email="rejected@example.com", status="rejected")
    add_user(session, email="new@example.com", verified=False)
    inactive = add_user(session, email="off@example.com", status="pending")
    inactive.is_active = False
    session.commit()

    def status(value):
        return emails(get(client, headers, "/admin/users", status=value, limit=100))

    assert status("pending") == ["pending@example.com"]
    assert status("rejected") == ["rejected@example.com"]
    assert status("not_signed_in") == ["new@example.com"]
    assert status("inactive") == ["off@example.com"]
    assert "agent@example.com" in status("active")
    assert not {"pending@example.com", "new@example.com"} & set(status("active"))
    assert (
        client.get(
            "/admin/users", headers=headers["admin"], params={"status": "x"}
        ).status_code
        == 422
    )


def test_users_are_paged_with_a_filtered_total(api):  # noqa: F811
    client, _, _, headers = api
    first = get(client, headers, "/admin/users", role="agent", limit=1)
    second = get(client, headers, "/admin/users", role="agent", limit=1, offset=1)
    assert first["total"] == second["total"] == 2
    assert emails(first) != emails(second)


# --- GET /admin/audit-logs ----------------------------------------------------


def test_audit_log_search_and_outcome_filter(api):  # noqa: F811
    client, session, users, headers = api
    request_id = str(uuid4())
    session.add_all(
        [
            AuditLog(action="report_exported", outcome="success"),
            AuditLog(
                action="report_exported",
                outcome="failure",
                request_id=request_id,
                actor_user_id=users["client"].id,
            ),
            AuditLog(action="discount_100%_applied", outcome="success"),
        ]
    )
    session.commit()

    # The page shows actions with spaces; the search accepts them.
    exported = get(client, headers, "/admin/audit-logs", q="Report exported")
    assert exported["total"] == 2
    failed = get(
        client, headers, "/admin/audit-logs", q="report exported", outcome="failure"
    )
    assert [row["request_id"] for row in failed["items"]] == [request_id]
    by_request = get(client, headers, "/admin/audit-logs", q=request_id[:13])
    assert by_request["total"] == 1
    by_actor = get(client, headers, "/admin/audit-logs", q=str(users["client"].id))
    assert {row["action"] for row in by_actor["items"]} >= {"report_exported"}
    percent = get(client, headers, "/admin/audit-logs", q="100%")
    assert [row["action"] for row in percent["items"]] == ["discount_100%_applied"]


def test_audit_log_unfiltered_total_counts_everything(api):  # noqa: F811
    client, session, _, headers = api
    everything = get(client, headers, "/admin/audit-logs", limit=100)
    assert everything["total"] == session.query(AuditLog).count()
    assert len(everything["items"]) == min(100, everything["total"])
