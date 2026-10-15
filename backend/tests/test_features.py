import json
from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

import pytest
from test_domain_tables import make_customer, make_user

from app.core.config import ROOT_DIR
from app.ml import features as f

FREE = frozenset({"gmail.com", "yahoo.com"})
NOW = datetime(2026, 10, 15, 12, tzinfo=UTC)
WINDOWS = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/141.0 Safari/537.36"
)
MAC = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/18.0 Safari/605.1.15"
)
ANDROID = (
    "Mozilla/5.0 (Linux; Android 14; SM-A145F) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36"
)
IPHONE = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
)
LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0"
CHROME_OS = (
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/141.0 Safari/537.36"
)


def registration(**overrides):
    values = {
        "full_name": "Amina Otieno",
        "email": "amina.otieno@gmail.com",
        "mobile_phone": "0712345678",
        "secondary_phone": None,
        "date_of_birth": date(1995, 5, 17),
        "country": "KE",
        "current_address_months": 24,
        "previous_address_months": None,
        "keep_signed_in": True,
        "session_length_minutes": 4.5,
        "device_id": uuid4(),
        "user_agent": WINDOWS,
        "ip_country": None,
        "assisted": False,
    }
    return f.RegistrationData(**(values | overrides))


def test_feature_order_matches_model_contract():
    contract = json.loads(
        (ROOT_DIR / "ml" / "model_contract" / "metadata.json").read_text("utf-8")
    )
    assert f.FEATURE_NAMES == tuple(contract["features"])


@pytest.mark.parametrize(
    ("name", "email", "expected"),
    [
        ("Amina Otieno", "amina.otieno@gmail.com", 1.0),
        ("Amina Otieno", "AMINA_OTIENO99@gmail.com", 1.0),
        ("Amina Otieno", "amina-otieno@example.com", 1.0),
        ("Amina Otieno", "xyz@gmail.com", 0.0),
        ("Amina Otieno", "123@gmail.com", 0.0),
    ],
)
def test_name_email_similarity(name, email, expected):
    assert f.name_email_similarity(name, email) == expected


def test_name_email_similarity_is_partial_for_partial_match():
    assert 0 < f.name_email_similarity("Amina Otieno", "aotieno@gmail.com") < 1


def test_normalise_for_similarity():
    assert f.normalise_for_similarity("Amina O_tieno-9.") == "aminaotieno"


def test_address_months():
    assert f.prev_address_months_count(None) is None
    assert f.prev_address_months_count(12) == 12.0
    assert f.current_address_months_count(0) == 0.0


def test_date_of_birth_distinct_emails_4w(db_session):
    agent = make_user(db_session)
    dob = date(1995, 5, 17)
    for email in ("a@example.test", "a@example.test", "b@example.test"):
        make_customer(db_session, agent, email=email, date_of_birth=dob)
    other_dob = date(1990, 1, 1)
    make_customer(db_session, agent, email="c@example.test", date_of_birth=other_dob)
    old = make_customer(db_session, agent, email="d@example.test", date_of_birth=dob)
    old.created_at = datetime.now(UTC) - timedelta(days=29)
    db_session.flush()

    assert f.date_of_birth_distinct_emails_4w(db_session, dob, datetime.now(UTC)) == 2


@pytest.mark.parametrize(
    ("email", "expected"),
    [("a@gmail.com", 1), ("a@GMAIL.COM", 1), ("a@company.co.ke", 0)],
)
def test_email_is_free(email, expected):
    assert f.email_is_free(email, FREE) == expected


@pytest.mark.parametrize(
    ("number", "expected"),
    [
        ("0712345678", 1),
        ("+254712345678", 1),
        ("+254 712 345 678", 1),
        ("12345", 0),
        ("not a number", 0),
        ("", 0),
        (None, 0),
    ],
)
def test_phone_is_valid(number, expected):
    assert f.phone_is_valid(number, "KE") == expected


def test_phone_features_use_the_right_field():
    assert f.phone_mobile_valid("0712345678", "KE") == 1
    assert f.phone_home_valid(None, "KE") == 0
    assert f.phone_home_valid("0201234567", "KE") == 1


@pytest.mark.parametrize(
    ("ip_country", "expected"), [(None, None), ("KE", 0), ("ke", 0), ("UG", 1)]
)
def test_foreign_request(ip_country, expected):
    assert f.foreign_request(ip_country, "KE") == expected


def test_source_is_internet():
    assert f.source() == "INTERNET"


def test_session_length():
    assert f.session_length_in_minutes(None) is None
    assert f.session_length_in_minutes(3) == 3.0


@pytest.mark.parametrize(
    ("user_agent", "expected"),
    [
        (WINDOWS, "windows"),
        (MAC, "macintosh"),
        (ANDROID, "other"),
        (IPHONE, "other"),
        (LINUX, "linux"),
        (CHROME_OS, "x11"),
        ("curl/8.0", "other"),
        ("", "other"),
        (None, "other"),
    ],
)
def test_device_os(user_agent, expected):
    assert f.device_os(user_agent) == expected


def test_keep_alive_session():
    assert (f.keep_alive_session(True), f.keep_alive_session(False)) == (1, 0)


def test_device_distinct_emails_8w(db_session):
    agent = make_user(db_session)
    device = uuid4()
    for email in ("a@example.test", "b@example.test", "b@example.test"):
        make_customer(db_session, agent, email=email, device_id=device)
    make_customer(db_session, agent, email="c@example.test", device_id=uuid4())
    old = make_customer(db_session, agent, email="d@example.test", device_id=device)
    old.created_at = datetime.now(UTC) - timedelta(days=57)
    db_session.flush()
    now = datetime.now(UTC)

    assert f.device_distinct_emails_8w(db_session, device, "new@example.test", now) == 3
    assert f.device_distinct_emails_8w(db_session, device, "A@example.test", now) == 2
    assert f.device_distinct_emails_8w(db_session, None, "a@example.test", now) is None


def test_build_features_returns_all_features_in_order(db_session):
    features = f.build_features(db_session, registration(), FREE, "KE", NOW)

    assert tuple(features) == f.FEATURE_NAMES
    assert features == {
        "name_email_similarity": 1.0,
        "prev_address_months_count": None,
        "current_address_months_count": 24.0,
        "date_of_birth_distinct_emails_4w": 0,
        "email_is_free": 1,
        "phone_home_valid": 0,
        "phone_mobile_valid": 1,
        "foreign_request": None,
        "source": "INTERNET",
        "session_length_in_minutes": 4.5,
        "device_os": "windows",
        "keep_alive_session": 1,
        "device_distinct_emails_8w": 1,
    }


def test_assisted_registration_hides_device_features(db_session):
    features = f.build_features(
        db_session, registration(assisted=True), FREE, "KE", NOW
    )
    for name in f.ASSISTED_UNKNOWN:
        assert features[name] is None
    assert features["phone_mobile_valid"] == 1


def test_model_input_hides_date_of_birth_count_but_keeps_snapshot():
    snapshot = {name: 1 for name in f.FEATURE_NAMES}
    prepared = f.model_input(snapshot)
    assert prepared["date_of_birth_distinct_emails_4w"] is None
    assert snapshot["date_of_birth_distinct_emails_4w"] == 1
    assert prepared["email_is_free"] == 1
