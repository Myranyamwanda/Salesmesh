from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints

type Role = Literal["admin", "agent", "client"]
# Shown to customers on the public /join page, so keep it short and trimmed.
type DisplayName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=2, max_length=100)
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


class ActiveInput(BaseModel):
    is_active: bool


class RoleInput(BaseModel):
    role: Role
