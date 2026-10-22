import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

import jwt

from app.core.config import Settings


def validate_password(password: str) -> str:
    """The SalesMesh password rule. Firebase checks real accounts' passwords
    (password policy) and so do the frontend forms; this checks DEMO_PASSWORD.
    """
    if not 12 <= len(password) <= 128:
        raise ValueError("Password must contain 12 to 128 characters")
    if (
        not any(character.islower() for character in password)
        or not any(character.isupper() for character in password)
        or not any(character.isdigit() for character in password)
        or not any(
            not character.isalnum() and not character.isspace()
            for character in password
        )
    ):
        raise ValueError(
            "Password must contain lowercase, uppercase, a digit, and a symbol"
        )
    return password


def new_token() -> str:
    return secrets.token_urlsafe(48)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def access_token(user, session_id: UUID, settings: Settings) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "sub": str(user.id),
            "role": user.role,
            "ver": user.token_version,
            "sid": str(session_id),
            "iat": now,
            "exp": now + timedelta(minutes=settings.access_token_minutes),
            "iss": settings.jwt_issuer,
            "aud": settings.jwt_audience,
        },
        settings.signing_key(),
        algorithm="HS256",
    )


def decode_access_token(token: str, settings: Settings) -> dict:
    return jwt.decode(
        token,
        settings.signing_key(),
        algorithms=["HS256"],
        issuer=settings.jwt_issuer,
        audience=settings.jwt_audience,
        options={"require": ["sub", "role", "ver", "sid", "iat", "exp", "iss", "aud"]},
    )
