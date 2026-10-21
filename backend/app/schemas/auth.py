from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    SecretStr,
    StringConstraints,
)

from app.core.security import validate_password


def check_new_password(value: SecretStr) -> SecretStr:
    validate_password(value.get_secret_value())
    return value


type NewPassword = Annotated[
    SecretStr, Field(min_length=12, max_length=128), AfterValidator(check_new_password)
]
type Role = Literal["admin", "agent", "client"]
# Shown to customers on the public /join page, so keep it short and trimmed.
type DisplayName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=2, max_length=100)
]


class EmailInput(BaseModel):
    email: EmailStr


class CredentialsInput(EmailInput):
    password: NewPassword


class RegistrationInput(CredentialsInput):
    display_name: DisplayName


class LoginInput(EmailInput):
    password: SecretStr = Field(min_length=1, max_length=128)


class TokenInput(BaseModel):
    token: str = Field(min_length=1, max_length=200)


class ResetPasswordInput(TokenInput):
    password: NewPassword


class FirebaseTokenInput(BaseModel):
    # A Firebase ID token is a JWT of about 1 KB.
    id_token: str = Field(min_length=1, max_length=8192)


class FirebaseRegistrationInput(FirebaseTokenInput):
    display_name: DisplayName


class ChangePasswordInput(BaseModel):
    current_password: SecretStr = Field(min_length=1, max_length=128)
    new_password: NewPassword


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


class MessageResponse(BaseModel):
    message: str


class CreateUserInput(EmailInput):
    # No password: the person sets one from Firebase's password-reset email.
    role: Literal["admin", "client"]


class ActiveInput(BaseModel):
    is_active: bool


class RoleInput(BaseModel):
    role: Role
