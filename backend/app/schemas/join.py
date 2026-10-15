from datetime import date
from typing import Annotated, Literal
from uuid import UUID

import phonenumbers
from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    EmailStr,
    Field,
    StringConstraints,
)

EARLIEST_DATE_OF_BIRTH = date(1900, 1, 1)


def empty_to_none(value: object) -> object:
    return None if isinstance(value, str) and not value.strip() else value


def check_date_of_birth(value: date) -> date:
    if not EARLIEST_DATE_OF_BIRTH <= value < date.today():
        raise ValueError("Date of birth must be in the past")
    return value


def check_country(value: str) -> str:
    if value not in phonenumbers.SUPPORTED_REGIONS:
        raise ValueError("Unknown country code")
    return value


type Text = Annotated[str, StringConstraints(strip_whitespace=True)]
type Months = Annotated[int, Field(ge=0, le=1200)]


class JoinAgentRead(BaseModel):
    display_name: str


class JoinRegistrationInput(BaseModel):
    """The public registration form. Only fields the model needs are collected."""

    full_name: Annotated[Text, StringConstraints(min_length=2, max_length=200)]
    email: EmailStr
    mobile_phone: Annotated[Text, StringConstraints(min_length=1, max_length=32)]
    secondary_phone: Annotated[
        Annotated[Text, StringConstraints(max_length=32)] | None,
        BeforeValidator(empty_to_none),
    ] = None
    # Collected only for the date-of-birth feature; age is not used.
    date_of_birth: Annotated[date, AfterValidator(check_date_of_birth)]
    country: Annotated[
        str,
        StringConstraints(to_upper=True, pattern="^[A-Za-z]{2}$"),
        AfterValidator(check_country),
    ]
    current_address_months: Months
    previous_address_months: Months | None = None
    keep_signed_in: bool = False
    # Kenya Data Protection Act 2019: registration needs explicit consent.
    consent: Literal[True]
    session_length_minutes: Annotated[float, Field(ge=0, le=1440)] | None = None
    device_id: UUID | None = None
    user_agent: Annotated[str, StringConstraints(max_length=512)] | None = None
    assisted: bool = False
