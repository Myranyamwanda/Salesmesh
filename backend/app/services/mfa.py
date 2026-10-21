"""Admin multi-factor authentication: TOTP codes from an authenticator app.

After Firebase sign-in, an admin receives a short-lived MFA token instead of the
SalesMesh tokens. The MFA token is a JWT with its own audience, so it can never
be used as an access token; it only lets the holder submit a TOTP code (or a
one-time recovery code) to finish signing in. Agents and clients skip this step.
"""

import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

import jwt
import pyotp
from cryptography.fernet import Fernet, InvalidToken
from fastapi import Request
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import CodedHTTPException
from app.core.security import token_hash
from app.models import MfaRecoveryCode, User
from app.services.audit import audit

ISSUER = "SalesMesh"
MFA_TOKEN_MINUTES = 5
RECOVERY_CODE_COUNT = 10
# No 0/O, 1/I/L: easy to read aloud and type from a printout.
RECOVERY_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"


def mfa_audience(settings: Settings) -> str:
    return f"{settings.jwt_audience}-mfa"


def cipher(settings: Settings) -> Fernet:
    if settings.totp_encryption_key is None:
        raise CodedHTTPException(
            503,
            "mfa_not_configured",
            "Admin sign-in is not configured: run the init-secret command",
        )
    return Fernet(settings.totp_encryption_key.get_secret_value())


def encrypt_secret(secret: str, settings: Settings) -> str:
    return cipher(settings).encrypt(secret.encode()).decode()


def decrypt_secret(encrypted: str, settings: Settings) -> str:
    try:
        return cipher(settings).decrypt(encrypted.encode()).decode()
    except InvalidToken:
        # The key changed since the secret was saved; the admin must re-enrol.
        raise CodedHTTPException(
            503,
            "mfa_key_mismatch",
            "This authenticator cannot be checked; ask for an MFA reset",
        ) from None


def new_mfa_token(user: User, settings: Settings) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "sub": str(user.id),
            "ver": user.token_version,
            "iat": now,
            "exp": now + timedelta(minutes=MFA_TOKEN_MINUTES),
            "iss": settings.jwt_issuer,
            "aud": mfa_audience(settings),
        },
        settings.signing_key(),
        algorithm="HS256",
    )


def mfa_user(session: Session, token: str, settings: Settings) -> User:
    """The admin an MFA token belongs to, locked for update; 401 when unusable."""
    expired = CodedHTTPException(
        401, "mfa_session_expired", "Your sign-in has expired; sign in again"
    )
    try:
        claims = jwt.decode(
            token,
            settings.signing_key(),
            algorithms=["HS256"],
            issuer=settings.jwt_issuer,
            audience=mfa_audience(settings),
            options={"require": ["sub", "ver", "iat", "exp", "iss", "aud"]},
        )
        user_id = UUID(claims["sub"])
    except jwt.InvalidTokenError, ValueError:
        raise expired from None
    user = session.scalar(select(User).where(User.id == user_id).with_for_update())
    if (
        user is None
        or user.role != "admin"
        or claims["ver"] != user.token_version
        or not user.is_active
        or user.status != "approved"
    ):
        raise expired
    return user


def challenge(
    session: Session, request: Request, user: User, settings: Settings, source: str
) -> dict:
    """The response for an admin whose Firebase sign-in succeeded."""
    cipher(settings)  # Fail clearly before the admin is asked for a code.
    audit(session, request, "mfa_required", actor=user, client_ip_hash=source)
    session.commit()
    return {
        "mfa": "verify" if user.totp_enabled_at else "setup",
        "mfa_token": new_mfa_token(user, settings),
        "expires_in": MFA_TOKEN_MINUTES * 60,
    }


def provisioning_uri(user: User, secret: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=user.email, issuer_name=ISSUER)


def begin_setup(user: User, settings: Settings) -> tuple[str, str]:
    """Store a new pending secret; return it and its otpauth:// URI for the QR code."""
    if user.totp_enabled_at is not None:
        raise CodedHTTPException(
            409, "mfa_already_enabled", "An authenticator app is already set up"
        )
    secret = pyotp.random_base32()
    user.totp_secret_encrypted = encrypt_secret(secret, settings)
    return secret, provisioning_uri(user, secret)


def matching_step(user: User, code: str, settings: Settings) -> int | None:
    """The time step this code belongs to, or None.

    Accepts the previous, current, and next 30-second step (clock drift), but
    never a step at or before the last accepted one, so a code works only once.
    """
    if user.totp_secret_encrypted is None or not (len(code) == 6 and code.isdigit()):
        return None
    totp = pyotp.TOTP(decrypt_secret(user.totp_secret_encrypted, settings))
    current = totp.timecode(datetime.now(UTC))
    last = user.totp_last_step if user.totp_last_step is not None else -1
    for step in (current - 1, current, current + 1):
        if step > last and secrets.compare_digest(totp.generate_otp(step), code):
            return step
    return None


def normalise_recovery_code(code: str) -> str:
    return "".join(character for character in code.upper() if character.isalnum())


def new_recovery_codes(session: Session, user: User) -> list[str]:
    """Replace the admin's recovery codes; return the new ones to show once."""
    session.execute(delete(MfaRecoveryCode).where(MfaRecoveryCode.user_id == user.id))
    codes = []
    for _ in range(RECOVERY_CODE_COUNT):
        raw = "".join(secrets.choice(RECOVERY_ALPHABET) for _ in range(12))
        codes.append(f"{raw[:4]}-{raw[4:8]}-{raw[8:]}")
        session.add(MfaRecoveryCode(user_id=user.id, code_hash=token_hash(raw)))
    return codes


def use_recovery_code(session: Session, user: User, code: str) -> bool:
    """Mark a matching unused recovery code as used. True when one matched."""
    used = session.execute(
        update(MfaRecoveryCode)
        .where(
            MfaRecoveryCode.user_id == user.id,
            MfaRecoveryCode.code_hash == token_hash(normalise_recovery_code(code)),
            MfaRecoveryCode.used_at.is_(None),
        )
        .values(used_at=datetime.now(UTC))
    )
    return used.rowcount == 1


def check_not_locked(user: User) -> None:
    now = datetime.now(UTC)
    if user.locked_until is not None and user.locked_until > now:
        seconds = int((user.locked_until - now).total_seconds()) + 1
        raise CodedHTTPException(
            429,
            "mfa_locked",
            "Too many wrong codes. Try again later.",
            headers={"Retry-After": str(seconds)},
        )


def record_failure(user: User, settings: Settings) -> None:
    """Count a wrong code; lock the account like repeated wrong passwords do."""
    now = datetime.now(UTC)
    if user.locked_until is not None and user.locked_until <= now:
        user.failed_login_attempts = 0
        user.locked_until = None
    user.failed_login_attempts += 1
    if user.failed_login_attempts >= settings.login_failure_limit:
        user.locked_until = now + timedelta(minutes=settings.account_lockout_minutes)


def enable_totp(session: Session, user: User, step: int) -> list[str]:
    """Turn TOTP on after the first correct code; return new recovery codes."""
    user.totp_enabled_at = datetime.now(UTC)
    user.totp_last_step = step
    return new_recovery_codes(session, user)


def reset_mfa(session: Session, user: User) -> None:
    """Remove the authenticator and recovery codes; the admin re-enrols next time."""
    user.totp_secret_encrypted = None
    user.totp_enabled_at = None
    user.totp_last_step = None
    session.execute(delete(MfaRecoveryCode).where(MfaRecoveryCode.user_id == user.id))
