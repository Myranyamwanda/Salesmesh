import pytest

from app.services.geoip import (
    NoCountryLookup,
    get_country_lookup,
    is_public_address,
    request_country,
)


class FixedLookup:
    def __init__(self, country):
        self.country_code = country
        self.calls = []

    def country(self, address):
        self.calls.append(address)
        return self.country_code


@pytest.mark.parametrize(
    ("address", "public"),
    [
        ("8.8.8.8", True),
        ("2001:4860:4860::8888", True),
        ("127.0.0.1", False),
        ("10.0.0.5", False),
        ("192.168.1.10", False),
        ("172.18.0.1", False),
        ("::1", False),
        ("testclient", False),
        ("unknown", False),
    ],
)
def test_is_public_address(address, public):
    assert is_public_address(address) is public


def test_private_addresses_are_never_looked_up():
    lookup = FixedLookup("UG")
    assert request_country(lookup, "192.168.1.10") is None
    assert lookup.calls == []


def test_public_addresses_use_the_provider():
    assert request_country(FixedLookup("ug"), "8.8.8.8") == "UG"
    assert request_country(FixedLookup(None), "8.8.8.8") is None


def test_default_provider_returns_unknown():
    assert isinstance(get_country_lookup(), NoCountryLookup)
    assert request_country(get_country_lookup(), "8.8.8.8") is None
