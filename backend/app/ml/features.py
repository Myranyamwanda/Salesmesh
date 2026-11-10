"""Turn one SalesMesh registration into the 11 features model v2 expects.

There is one function per feature, so each rule can be tested and explained
on its own. The BAF dataset the model was trained on is bank application data,
so some features are adaptations; each function's docstring says how.

build_features() returns the raw values, which are stored as the snapshot on
the risk assessment. model_input() then prepares those values for the model.

Model v2 (v1.4.0) dropped name_email_similarity and keep_alive_session, so the
name-email similarity is no longer computed or stored (data minimisation) and
/join has no "Keep me signed in" box. Snapshots scored by model v1 keep their
13 values as history.
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any
from uuid import UUID

import phonenumbers
from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session

from app.models import Customer

# Same order as "features" in metadata.json (a test checks this).
FEATURE_NAMES = (
    "prev_address_months_count",
    "current_address_months_count",
    "date_of_birth_distinct_emails_4w",
    "email_is_free",
    "phone_home_valid",
    "phone_mobile_valid",
    "foreign_request",
    "source",
    "session_length_in_minutes",
    "device_os",
    "device_distinct_emails_8w",
)
# Measured on the customer's own device, so unknown when an agent registers
# the customer on the agent's device.
ASSISTED_UNKNOWN = (
    "session_length_in_minutes",
    "device_os",
    "device_distinct_emails_8w",
)
# Stored in the snapshot but sent to the model as None. In BAF this is a
# bank-scale count; on a small platform it is almost always 0, which the model
# reads as high risk. None is imputed with the training median (neutral).
NOT_SENT_TO_MODEL = ("date_of_birth_distinct_emails_4w",)

DATE_OF_BIRTH_WINDOW = timedelta(days=28)
DEVICE_WINDOW = timedelta(days=56)


@dataclass(frozen=True)
class RegistrationData:
    """The registration form plus what the browser and request add to it."""

    full_name: str
    email: str
    mobile_phone: str
    secondary_phone: str | None
    date_of_birth: date
    country: str
    current_address_months: int
    previous_address_months: int | None
    session_length_minutes: float | None
    device_id: UUID | None
    user_agent: str | None
    ip_country: str | None
    assisted: bool


def prev_address_months_count(months: int | None) -> float | None:
    """Months at the previous address; an empty answer is missing (None)."""
    return None if months is None else float(months)


def current_address_months_count(months: int) -> float:
    """Months at the current address (a required form field)."""
    return float(months)


def date_of_birth_distinct_emails_4w(
    session: Session, date_of_birth: date, now: datetime
) -> int:
    """Distinct emails of customers with this date of birth in the last 28 days.

    Called before the new customer is saved, so that customer is excluded.
    """
    return session.scalar(
        select(func.count(distinct(Customer.email))).where(
            Customer.date_of_birth == date_of_birth,
            Customer.created_at >= now - DATE_OF_BIRTH_WINDOW,
        )
    )


def email_is_free(email: str, free_domains: frozenset[str]) -> int:
    """1 if the email uses a free provider from the configured list, else 0."""
    domain = email.rsplit("@", 1)[-1].lower()
    return int(domain in free_domains)


def phone_is_valid(number: str | None, region: str) -> int:
    """1 for a valid phone number (national numbers use region), else 0."""
    if not number:
        return 0
    try:
        return int(phonenumbers.is_valid_number(phonenumbers.parse(number, region)))
    except phonenumbers.NumberParseException:
        return 0


def phone_home_valid(secondary_phone: str | None, region: str) -> int:
    """Adaptation: BAF's home phone is mapped to an optional secondary number,
    because landlines are rare in Kenya."""
    return phone_is_valid(secondary_phone, region)


def phone_mobile_valid(mobile_phone: str, region: str) -> int:
    """1 if the required mobile number is valid. Invalid numbers are still
    accepted; this feature records that they were invalid."""
    return phone_is_valid(mobile_phone, region)


def foreign_request(ip_country: str | None, form_country: str) -> int | None:
    """1 if the request came from another country than the form states.

    None when the IP country is unknown (development and private addresses).
    """
    if ip_country is None:
        return None
    return int(ip_country.upper() != form_country.upper())


def source() -> str:
    """Always "INTERNET" for the web form; "TELEAPP" is for a future app."""
    return "INTERNET"


def session_length_in_minutes(minutes: float | None) -> float | None:
    """Minutes from opening the form to submitting it, measured by the browser."""
    return None if minutes is None else float(minutes)


def device_os(user_agent: str | None) -> str:
    """Map a browser user agent to one of the model's device_os categories.

    The order matters: Android user agents contain "Linux" and iOS user
    agents contain "Mac OS X", so mobile systems are checked first. iPads
    that request the desktop site report "Macintosh" and map to macintosh.
    """
    agent = user_agent or ""
    if any(mobile in agent for mobile in ("Android", "iPhone", "iPad", "iPod")):
        return "other"
    if "Windows" in agent:
        return "windows"
    if "Macintosh" in agent:
        return "macintosh"
    if "X11" in agent:
        return "linux" if "Linux" in agent else "x11"
    return "other"


def device_distinct_emails_8w(
    session: Session, device_id: UUID | None, email: str, now: datetime
) -> int | None:
    """Distinct emails registered from this device in the last 56 days,
    including the current registration. No device ID means missing (None)."""
    if device_id is None:
        return None
    emails = session.scalars(
        select(distinct(Customer.email)).where(
            Customer.device_id == device_id,
            Customer.created_at >= now - DEVICE_WINDOW,
        )
    )
    return len(set(emails) | {email.lower()})


def build_features(
    session: Session,
    data: RegistrationData,
    free_domains: frozenset[str],
    region: str,
    now: datetime,
) -> dict[str, Any]:
    """Return the raw value of every feature, in the model's order."""
    features = {
        "prev_address_months_count": prev_address_months_count(
            data.previous_address_months
        ),
        "current_address_months_count": current_address_months_count(
            data.current_address_months
        ),
        "date_of_birth_distinct_emails_4w": date_of_birth_distinct_emails_4w(
            session, data.date_of_birth, now
        ),
        "email_is_free": email_is_free(data.email, free_domains),
        "phone_home_valid": phone_home_valid(data.secondary_phone, region),
        "phone_mobile_valid": phone_mobile_valid(data.mobile_phone, region),
        "foreign_request": foreign_request(data.ip_country, data.country),
        "source": source(),
        "session_length_in_minutes": session_length_in_minutes(
            data.session_length_minutes
        ),
        "device_os": device_os(data.user_agent),
        "device_distinct_emails_8w": device_distinct_emails_8w(
            session, data.device_id, data.email, now
        ),
    }
    if data.assisted:
        features.update(dict.fromkeys(ASSISTED_UNKNOWN))
    return features


def clip_to_range(value: float | None, low: float, high: float) -> float | None:
    """Limit a value to [low, high]; missing values stay missing."""
    return None if value is None else min(max(float(value), low), high)


def model_input(
    features: dict[str, Any], numeric_ranges: dict[str, dict[str, float]]
) -> dict[str, Any]:
    """Prepare raw feature values for the model, leaving the snapshot as it is.

    Numeric values are clipped to the training min and max from metadata.json
    "numeric_ranges": a linear model extrapolates without limit, so a value it
    never saw (for example 10 emails on one device) would dominate the score.
    Extreme values are handled by transparent rules instead (services/scoring.py).
    """
    prepared = dict(features)
    for name, limits in numeric_ranges.items():
        prepared[name] = clip_to_range(prepared[name], limits["min"], limits["max"])
    prepared.update(dict.fromkeys(NOT_SENT_TO_MODEL))
    return prepared
