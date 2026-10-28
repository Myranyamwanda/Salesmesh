"""Real-email checks for agent self-registration and public /join registration.

An address is refused when its domain is a known disposable (throwaway) email
service, or when the domain publishes no mail server (MX record). If DNS cannot
be reached, the address is accepted and a warning is logged: a DNS outage must
not stop registrations. The demo seed never goes through these checks.
"""

import logging
from functools import lru_cache
from pathlib import Path

import dns.exception
import dns.name
import dns.resolver

from app.core.config import Settings
from app.core.errors import CodedHTTPException

logger = logging.getLogger(__name__)
DISPOSABLE_LIST = (
    Path(__file__).resolve().parents[1] / "data" / "disposable_email_domains.txt"
)
NOT_PERMANENT = "Use a permanent email address"


@lru_cache
def disposable_domains() -> frozenset[str]:
    lines = DISPOSABLE_LIST.read_text(encoding="utf-8").splitlines()
    return frozenset(
        line.strip().lower()
        for line in lines
        if line.strip() and not line.startswith("#")
    )


def is_disposable(domain: str) -> bool:
    """True for a listed domain or any subdomain of one (x.mailinator.com)."""
    labels = domain.lower().split(".")
    candidates = {".".join(labels[index:]) for index in range(len(labels) - 1)}
    return not candidates.isdisjoint(disposable_domains())


def make_resolver(nameservers: tuple[str, ...]) -> dns.resolver.Resolver:
    """The system resolver, or one that asks only the configured DNS servers.

    Some home routers never answer for a domain that does not exist, so the
    lookup times out and the address is accepted; EMAIL_DNS_SERVERS avoids that.
    """
    if not nameservers:
        return dns.resolver.get_default_resolver()
    resolver = dns.resolver.Resolver(configure=False)
    resolver.nameservers = list(nameservers)
    return resolver


def mx_hosts(
    domain: str, timeout: float, nameservers: tuple[str, ...] = ()
) -> list[str] | None:
    """Mail servers of a domain; [] when it has none; None when DNS is unreachable."""
    try:
        answer = make_resolver(nameservers).resolve(domain, "MX", lifetime=timeout)
    except dns.resolver.NXDOMAIN, dns.resolver.NoAnswer:
        return []
    except dns.exception.DNSException as exc:
        logger.warning(
            "email_dns_unavailable",
            extra={"domain": domain, "reason": type(exc).__name__},
        )
        return None
    # A "null MX" (RFC 7505, a single "." host) says the domain takes no mail.
    return [
        str(record.exchange) for record in answer if record.exchange != dns.name.root
    ]


def check_permanent_email(email: str, settings: Settings) -> None:
    """Raise a 422 with the field message unless the address can receive mail."""
    domain = email.rsplit("@", 1)[-1].lower()
    if is_disposable(domain) or (
        mx_hosts(
            domain, settings.email_dns_timeout_seconds, settings.email_dns_server_list
        )
        == []
    ):
        raise CodedHTTPException(422, "email_not_permanent", NOT_PERMANENT)
