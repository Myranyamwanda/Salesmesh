from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    model_validator,
)

type Role = Literal["admin", "agent", "client"]
# Shown to customers on the public /join page, so keep it short and trimmed.
type DisplayName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=2, max_length=100)
]

# A client's organisation, shown on the /join page and named in the consent text.
type OrganisationName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=2, max_length=200)
]


class EmailInput(BaseModel):
    email: EmailStr


class FirebaseTokenInput(BaseModel):
    # A Firebase ID token is a JWT of about 1 KB.
    id_token: str = Field(min_length=1, max_length=8192)


class FirebaseRegistrationInput(FirebaseTokenInput):
    display_name: DisplayName


class MfaChallengeResponse(BaseModel):
    """Returned to an admin instead of tokens: "setup" or "verify" comes next."""

    mfa: Literal["setup", "verify"]
    mfa_token: str
    expires_in: int


class MfaTokenInput(BaseModel):
    mfa_token: str = Field(min_length=1, max_length=2048)


class MfaCodeInput(MfaTokenInput):
    # A 6-digit TOTP code, or a recovery code such as ABCD-EFGH-JKMN.
    code: str = Field(min_length=6, max_length=32)


class MfaSetupResponse(BaseModel):
    secret: str
    otpauth_uri: str


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    email: EmailStr
    role: Role
    status: Literal["pending", "approved", "rejected"]
    is_active: bool
    email_verified_at: datetime | None
    # True once the account has a Firebase user (signed in, or created by an admin).
    firebase_linked: bool
    created_at: datetime


class AccessTokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int


class MfaEnabledResponse(AccessTokenResponse):
    # Shown once; only their hashes are stored.
    recovery_codes: list[str]


class MessageResponse(BaseModel):
    message: str


class CreateUserInput(EmailInput):
    # No password: the person sets one from Firebase's password-reset email.
    role: Literal["admin", "client"]
    # Required for clients: their agents' /join links need it.
    organisation_name: OrganisationName | None = None

    @model_validator(mode="after")
    def check_organisation(self) -> Self:
        if self.role == "client" and self.organisation_name is None:
            raise ValueError("A client needs an organisation name")
        if self.role != "client" and self.organisation_name is not None:
            raise ValueError("Only clients have an organisation name")
        return self


class ActiveInput(BaseModel):
    is_active: bool


class RoleInput(BaseModel):
    role: Role
