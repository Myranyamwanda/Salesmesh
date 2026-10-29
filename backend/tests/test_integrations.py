"""v1.2.0 integration points: the reputation API for other modules and the
client's verified-customer export."""

import csv
import io
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from test_auth import auth_context  # noqa: F401
from test_phase4_api import add_scored_customer, api  # noqa: F401

from app.api.client import safe_cell
from app.core.config import get_settings
from app.models import AgentProfile, AuditLog, Customer, ScoringConfig
from app.services.reputation import agent_reputations
from app.services.reviews import apply_review


def audits(session, action):
    return session.query(AuditLog).filter(AuditLog.action == action).all()


# --- Reputation API ---------------------------------------------------------


@pytest.fixture
def scored(api):  # noqa: F811
    """The agent: 3 clear, 1 flagged and pending, 1 confirmed fake."""
    client, session, users, headers = api
    for _ in range(3):
        add_scored_customer(session, users["agent"], flagged=False)
    add_scored_customer(session, users["agent"], flagged=True)
    _, fake = add_scored_customer(session, users["agent"], flagged=True)
    apply_review(session, None, users["admin"], fake, "confirmed_fake", None)
    session.commit()
    return client, session, users, headers


def test_admin_reads_an_agent_reputation(scored):
    client, session, users, headers = scored
    agent_id = users["agent"].id

    response = client.get(
        f"/api/v1/agents/{agent_id}/reputation", headers=headers["admin"]
    )

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"agent_id", "score", "band", "n", "flags", "computed_at"}
    live = agent_reputations(session, session.get(ScoringConfig, 1))[agent_id]
    # 5 customers, 2 flags: 100 * (1 - (2 + 0.539) / 15) = 83.1.
    assert (
        (body["score"], body["band"], body["n"], body["flags"])
        == (
            live.reputation,
            "Insufficient data",
            5,
            2,
        )
        == (83.1, "Insufficient data", 5, 2)
    )
    assert body["agent_id"] == str(agent_id)
    computed = datetime.fromisoformat(body["computed_at"])
    assert abs((datetime.now(UTC) - computed).total_seconds()) < 60

    [entry] = audits(session, "reputation_api_read")
    assert (entry.outcome, entry.actor_user_id, entry.target_user_id) == (
        "success",
        users["admin"].id,
        agent_id,
    )
    assert entry.subject == f"agent:{agent_id}"


def test_unauthenticated_request_is_401(scored):
    client, _, users, _ = scored
    url = f"/api/v1/agents/{users['agent'].id}/reputation"
    assert client.get(url).status_code == 401
    bad_token = {"Authorization": "Bearer not-a-token"}
    assert client.get(url, headers=bad_token).status_code == 401


@pytest.mark.parametrize("role", ["agent", "client"])
def test_non_admin_request_is_403(scored, role):
    client, _, users, headers = scored
    url = f"/api/v1/agents/{users['agent'].id}/reputation"
    response = client.get(url, headers=headers[role])
    assert response.status_code == 403
    assert "score" not in response.text


def test_unknown_agent_is_404_and_audited(scored):
    client, session, users, headers = scored
    for missing in (uuid4(), users["client"].id):
        response = client.get(
            f"/api/v1/agents/{missing}/reputation", headers=headers["admin"]
        )
        assert response.status_code == 404
    outcomes = [entry.outcome for entry in audits(session, "reputation_api_read")]
    assert outcomes == ["failure", "failure"]


def test_requests_over_the_limit_are_429_and_audited(scored):
    client, session, users, headers = scored
    # Copy the test app's settings (they hold the test JWT secret).
    current = client.app.dependency_overrides[get_settings]()
    settings = current.model_copy(
        update={
            "reputation_api_rate_limit": 2,
            "reputation_api_rate_window_seconds": 60,
        }
    )
    client.app.dependency_overrides[get_settings] = lambda: settings
    url = f"/api/v1/agents/{users['agent'].id}/reputation"

    statuses = [client.get(url, headers=headers["admin"]) for _ in range(3)]

    assert [response.status_code for response in statuses] == [200, 200, 429]
    assert statuses[2].headers["Retry-After"] == "60"
    assert "score" not in statuses[2].text
    outcomes = [entry.outcome for entry in audits(session, "reputation_api_read")]
    assert sorted(outcomes) == ["rate_limited", "success", "success"]
    # Requests rejected before authorisation do not use up the admin's limit.
    assert client.get(url, headers=headers["agent"]).status_code == 403


# --- Client export ----------------------------------------------------------


@pytest.fixture
def export_data(api):  # noqa: F811
    """Customers of the client's agent, with every outcome."""
    client, session, users, headers = api
    session.get(AgentProfile, users["agent"].id).client_id = users["client"].id
    session.commit()
    mine = {"client_id": users["client"].id}

    def add(name, flagged, decision=None, **overrides):
        customer, assessment = add_scored_customer(
            session,
            users["agent"],
            flagged=flagged,
            full_name=name,
            mobile_phone="+254712345678",
            **(mine | overrides),
        )
        if decision:
            apply_review(session, None, users["admin"], assessment, decision, None)
        session.commit()
        return customer

    included = [
        add("Clear Customer", flagged=False),
        add("Verified Customer", flagged=True, decision="confirmed_real"),
    ]
    add("Waiting Customer", flagged=True)
    add("Fake Customer", flagged=True, decision="confirmed_fake")
    add("Old Consent", flagged=False, consent_version=1)
    add("Rival Customer", flagged=False, client_id=users["other_client"].id)
    return client, session, users, headers, included


def read_csv(response):
    assert response.content.startswith("﻿".encode())
    return list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))


def test_export_has_only_verified_and_clear_customers_of_this_client(export_data):
    client, session, _, headers, included = export_data

    response = client.get("/client/customers/export.csv", headers=headers["client"])

    assert response.status_code == 200
    assert response.headers["content-type"] == "text/csv; charset=utf-8"
    assert response.headers["content-disposition"].startswith(
        'attachment; filename="salesmesh-customers-'
    )
    assert response.headers["cache-control"] == "no-store"
    header, *rows = read_csv(response)
    assert header == [
        "reference",
        "full_name",
        "email",
        "mobile_phone",
        "registered_on",
    ]
    assert sorted(row[1] for row in rows) == ["Clear Customer", "Verified Customer"]
    by_name = {row[1]: row for row in rows}
    for customer in included:
        assert by_name[customer.full_name] == [
            customer.reference,
            customer.full_name,
            customer.email,
            "+254712345678",
            customer.created_at.astimezone(UTC).date().isoformat(),
        ]
    text = response.text.lower()
    for word in ("probability", "flag", "reason", "score", "status", "review"):
        assert word not in text


def test_consent_version_1_customers_are_never_exported(export_data):
    """The same clear customer is left out with consent version 1 and
    included once it has the v1.2.0 consent (version 2)."""
    client, session, _, headers, _ = export_data
    customer = session.query(Customer).filter_by(full_name="Old Consent").one()
    assert customer.consent_version == 1

    names = [
        row[1]
        for row in read_csv(
            client.get("/client/customers/export.csv", headers=headers["client"])
        )[1:]
    ]
    assert "Old Consent" not in names

    customer.consent_version = 2
    session.commit()
    names = [
        row[1]
        for row in read_csv(
            client.get("/client/customers/export.csv", headers=headers["client"])
        )[1:]
    ]
    assert "Old Consent" in names


def test_export_is_audited_without_personal_data(export_data):
    client, session, users, headers, included = export_data
    client.get("/client/customers/export.csv", headers=headers["client"])
    [entry] = audits(session, "customers_exported")
    assert (entry.outcome, entry.actor_user_id, entry.subject) == (
        "success",
        users["client"].id,
        "export:2 rows",
    )
    for customer in included:
        assert customer.email not in (entry.subject or "")


def test_rival_client_exports_only_its_own_customers(export_data):
    client, _, _, headers, _ = export_data
    response = client.get(
        "/client/customers/export.csv", headers=headers["other_client"]
    )
    assert [row[1] for row in read_csv(response)[1:]] == ["Rival Customer"]


def test_export_neutralises_spreadsheet_formulas(export_data):
    client, session, users, headers, _ = export_data
    customer, _ = add_scored_customer(
        session,
        users["agent"],
        flagged=False,
        full_name='=HYPERLINK("http://evil.example","Click")',
        client_id=users["client"].id,
    )
    session.commit()
    rows = read_csv(
        client.get("/client/customers/export.csv", headers=headers["client"])
    )
    [cell] = [row[1] for row in rows if "HYPERLINK" in row[1]]
    assert cell == "'" + customer.full_name


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("=1+1", "'=1+1"),
        ("@SUM(A1)", "'@SUM(A1)"),
        ("-2+3", "'-2+3"),
        ("+254712345678", "+254712345678"),
        ("+254 712 345 678", "+254 712 345 678"),
        ("Wanjiru Kamau", "Wanjiru Kamau"),
    ],
)
def test_safe_cell(value, expected):
    assert safe_cell(value) == expected


@pytest.mark.parametrize("role", ["admin", "agent"])
def test_only_clients_can_export(api, role):  # noqa: F811
    client, session, _, headers = api
    url = "/client/customers/export.csv"
    assert client.get(url, headers=headers[role]).status_code == 403
    assert client.get(url).status_code == 401
    assert audits(session, "customers_exported") == []


def test_empty_export_has_the_header_only(api):  # noqa: F811
    client, _, _, headers = api
    rows = read_csv(
        client.get("/client/customers/export.csv", headers=headers["client"])
    )
    assert rows == [
        ["reference", "full_name", "email", "mobile_phone", "registered_on"]
    ]
