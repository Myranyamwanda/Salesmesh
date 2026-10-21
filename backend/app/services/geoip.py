"""Find the country of a request IP address, for the foreign_request feature.

The lookup is replaceable: CountryLookup is an interface, and
get_country_lookup() is a FastAPI dependency, so a real provider (for example
an offline GeoLite2 database) can be added later without changing callers.
"""

import ipaddress
from typing import Protocol


class CountryLookup(Protocol):
    def country(self, address: str) -> str | None:
        """Return an ISO 3166-1 alpha-2 code, or None when unknown."""
        ...


class NoCountryLookup:
    """Default provider: the country is always unknown (foreign_request=None)."""

    def country(self, address: str) -> str | None:
        return None


def is_public_address(address: str) -> bool:
    try:
        return ipaddress.ip_address(address).is_global
    except ValueError:
        return False


def request_country(lookup: CountryLookup, address: str) -> str | None:
    """Private, local, and invalid addresses never have a country."""
    if not is_public_address(address):
        return None
    country = lookup.country(address)
    return country.upper() if country else None


def get_country_lookup() -> CountryLookup:
    return NoCountryLookup()
