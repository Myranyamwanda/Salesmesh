"""Real-email checks: disposable domains and MX records, without the network.

The autouse fake_dns fixture (conftest.py) replaces the MX lookup in every test;
the mx_hosts tests below call the real function with a fake DNS resolver.
"""

import dns.exception
import dns.name
import dns.resolver
import pytest
from sqlalchemy import select
from test_auth import auth_context  # noqa: F401
from test_firebase_auth import error_code
from test_join import count, form, join  # noqa: F401

from app.core.config import get_settings
from app.core.errors import CodedHTTPException
from app.models import Customer, User
from app.services import email_checks
from app.services.email_checks import (
    check_permanent_email,
    disposable_domains,
    is_disposable,
)

REAL_MX_HOSTS = email_checks.mx_hosts  # Captured before fake_dns patches it.


class Record:
    def __init__(self, host):
        self.exchange = dns.name.root if host == "." else dns.name.from_text(host)


class FakeResolver:
    def __init__(self, result):
        self.result = result

    def resolve(self, domain, record_type, lifetime):
        assert record_type == "MX" and lifetime == 2.0
        if isinstance(self.result, Exception):
            raise self.result
        return [Record(host) for host in self.result]


def resolver_returning(monkeypatch, result):
    monkeypatch.setattr(
        email_checks, "make_resolver", lambda nameservers: FakeResolver(result)
    )


def test_vendored_list_loads_without_its_header():
    domains = disposable_domains()
    assert len(domains) > 9000
    assert "mailinator.com" in domains
    assert not any(domain.startswith("#") for domain in domains)


@pytest.mark.parametrize(
    ("domain", "expected"),
    [
        ("mailinator.com", True),
        ("Inbox.Mailinator.com", True),  # Subdomains of a listed domain too.
        ("gmail.com", False),
        ("strathmore.edu", False),
        ("com", False),
    ],
)
def test_is_disposable(domain, expected):
    assert is_disposable(domain) is expected


@pytest.mark.parametrize(
    ("result", "expected"),
    [
        (
            ["mx1.example.com.", "mx2.example.com."],
            ["mx1.example.com.", "mx2.example.com."],
        ),
        (dns.resolver.NXDOMAIN(), []),
        (dns.resolver.NoAnswer(), []),
        (["."], []),  # Null MX: the domain says it accepts no mail.
        (dns.resolver.LifetimeTimeout(timeout=2.0, errors={}), None),
        (dns.resolver.NoNameservers(), None),
    ],
)
def test_mx_hosts(monkeypatch, result, expected):
    resolver_returning(monkeypatch, result)
    assert REAL_MX_HOSTS("example.com", 2.0) == expected


def test_dns_failure_is_logged(monkeypatch, caplog):
    resolver_returning(monkeypatch, dns.exception.Timeout())
    assert REAL_MX_HOSTS("example.com", 2.0) is None
    assert "email_dns_unavailable" in caplog.text


def test_configured_dns_servers_replace_the_system_resolver():
    settings = get_settings().model_copy(
        update={"email_dns_servers": " 1.1.1.1, 8.8.8.8 ,"}
    )
    assert settings.email_dns_server_list == ("1.1.1.1", "8.8.8.8")
    resolver = email_checks.make_resolver(settings.email_dns_server_list)
    assert resolver.nameservers == ["1.1.1.1", "8.8.8.8"]
    default = get_settings().model_copy(update={"email_dns_servers": ""})
    assert (
        email_checks.make_resolver(default.email_dns_server_list)
        is dns.resolver.get_default_resolver()
    )


def test_check_permanent_email(fake_dns):
    settings = get_settings()
    # A plus-address is an ordinary address on its domain.
    check_permanent_email("name+admin@gmail.com", settings)
    assert fake_dns.lookups == ["gmail.com"]
    fake_dns.records["no-mail.example"] = []
    with pytest.raises(CodedHTTPException) as rejected:
        check_permanent_email("someone@no-mail.example", settings)
    assert (rejected.value.status_code, rejected.value.code) == (
        422,
        "email_not_permanent",
    )
    assert rejected.value.detail == "Use a permanent email address"
    with pytest.raises(CodedHTTPException):
        check_permanent_email("someone@mailinator.com", settings)
    # A disposable domain is refused without a DNS lookup.
    assert "mailinator.com" not in fake_dns.lookups
    fake_dns.records["unreachable.example"] = None
    check_permanent_email("someone@unreachable.example", settings)


@pytest.mark.parametrize(
    ("email", "record", "status"),
    [
        ("customer@mailinator.com", None, 422),
        ("customer@no-mail.example", [], 422),
        ("customer@dns-down.example", None, 201),
    ],
)
def test_join_rejects_addresses_that_cannot_receive_mail(
    join,  # noqa: F811
    fake_dns,
    email,
    record,
    status,
):
    client, session, _, _, code = join
    domain = email.split("@")[1]
    fake_dns.records[domain] = record
    response = client.post(f"/join/{code}/register", json=form(email=email))
    assert response.status_code == status
    if status == 422:
        assert error_code(response) == "email_not_permanent"
        assert response.json()["error"]["message"] == "Use a permanent email address"
        assert count(session, Customer) == 0
    else:
        assert count(session, Customer) == 1


def test_agent_registration_rejects_disposable_email(
    auth_context,  # noqa: F811
    fake_firebase,
    fake_dns,
):
    client, session, _, _ = auth_context
    for email in ("agent@mailinator.com", "agent@no-mail.example"):
        fake_dns.records["no-mail.example"] = []
        uid = fake_firebase.add_user(email)
        response = client.post(
            "/auth/firebase/register",
            json={"id_token": fake_firebase.token(uid), "display_name": "Amina"},
        )
        assert response.status_code == 422
        assert error_code(response) == "email_not_permanent"
    assert session.scalar(select(User.id)) is None
