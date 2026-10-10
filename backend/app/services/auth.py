import hashlib
import hmac
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi import HTTPException, Request
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import (
    DUMMY_PASSWORD_HASH,
    access_token,
    hash_password,
    new_token,
    password_hasher,
    token_hash,
    verify_password,
)
from app.models import AuditLog, PasswordResetToken, RefreshToken, User
from app.services.audit import audit
from app.services.email import EmailSender, send_token_email


def unauthorized() -> HTTPException:
    return HTTPException(
        401, "Authentication failed", headers={"WWW-Authenticate": "Bearer"}
    )


def revoke_sessions(session: Session, user: User, session_id=None) -> None:
    if session_id is None:
        user = session.scalar(
            select(User)
            .where(User.id == user.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    statement = update(RefreshToken).where(
        RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None)
    )
    if session_id is not None:
        statement = statement.where(RefreshToken.session_id == session_id)
    else:
        user.token_version += 1
    session.execute(statement.values(revoked_at=datetime.now(UTC)))


def active_user(user: User) -> bool:
    return (
        user.is_active
        and user.status == "approved"
        and user.email_verified_at is not None
    )


def check_login_rate(session: Session, request: Request, settings: Settings) -> str:
    address = request.client.host if request.client else "unknown"
    hashed = hmac.new(
        settings.signing_key().encode(), address.encode(), hashlib.sha256
    ).hexdigest()
    lock_key = int(hashed[:15], 16)
    session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})
    since = datetime.now(UTC) - timedelta(seconds=settings.login_rate_window_seconds)
    attempts = session.scalar(
        select(func.count())
        .select_from(AuditLog)
        .where(
            AuditLog.client_ip_hash == hashed,
            AuditLog.action.in_(["login_success", "login_failure"]),
            AuditLog.created_at >= since,
        )
    )
    if attempts >= settings.login_rate_limit:
        session.commit()
        raise HTTPException(
            429,
            "Too many login attempts",
            headers={"Retry-After": str(settings.login_rate_window_seconds)},
        )
    return hashed


def login(
    session: Session, request: Request, email: str, password: str, settings: Settings
):
    source = check_login_rate(session, request, settings)
    user = session.scalar(
        select(User).where(User.email == email.lower()).with_for_update()
    )
    now = datetime.now(UTC)
    locked = (
        user is not None and user.locked_until is not None and user.locked_until > now
    )
    valid = verify_password(
        password, user.password_hash if user else DUMMY_PASSWORD_HASH
    )
    if user is None or locked or not valid or not active_user(user):
        if user is not None and not locked and not valid:
            if user.locked_until is not None and user.locked_until <= now:
                user.failed_login_attempts = 0
                user.locked_until = None
            user.failed_login_attempts += 1
            if user.failed_login_attempts >= settings.login_failure_limit:
                user.locked_until = now + timedelta(
                    minutes=settings.account_lockout_minutes
                )
        audit(
            session,
            request,
            "login_failure",
            "failure",
            target=user,
            client_ip_hash=source,
        )
        session.commit()
        raise unauthorized()
    user.failed_login_attempts = 0
    user.locked_until = None
    if password_hasher.check_needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    raw = new_token()
    session_id = uuid4()
    session.add(
        RefreshToken(
            user_id=user.id,
            session_id=session_id,
            token_hash=token_hash(raw),
            expires_at=now + timedelta(days=settings.refresh_token_days),
        )
    )
    encoded = access_token(user, session_id, settings)
    audit(session, request, "login_success", actor=user, client_ip_hash=source)
    session.commit()
    return encoded, raw


def refresh(session: Session, request: Request, raw: str, settings: Settings):
    candidate = session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash(raw))
    )
    if candidate is None:
        raise unauthorized()
    user = session.scalar(
        select(User).where(User.id == candidate.user_id).with_for_update()
    )
    token = session.scalar(
        select(RefreshToken)
        .where(RefreshToken.id == candidate.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if token.revoked_at is not None:
        revoke_sessions(session, user, token.session_id)
        audit(session, request, "refresh_reuse", "failure", actor=user)
        session.commit()
        raise unauthorized()
    now = datetime.now(UTC)
    if token.expires_at <= now or not active_user(user):
        revoke_sessions(session, user, token.session_id)
        session.commit()
        raise unauthorized()
    token.revoked_at = now
    replacement = new_token()
    session.add(
        RefreshToken(
            user_id=user.id,
            session_id=token.session_id,
            token_hash=token_hash(replacement),
            expires_at=token.expires_at,
        )
    )
    encoded = access_token(user, token.session_id, settings)
    audit(session, request, "session_refreshed", actor=user)
    session.commit()
    return encoded, replacement, max(0, int((token.expires_at - now).total_seconds()))


def logout(session: Session, request: Request, raw: str | None) -> None:
    if raw:
        token = session.scalar(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash(raw))
        )
        if token:
            user = session.scalar(
                select(User).where(User.id == token.user_id).with_for_update()
            )
            revoke_sessions(session, user, token.session_id)
            audit(session, request, "logout", actor=user)
    session.commit()


def issue_verification(user: User, settings: Settings) -> str:
    raw = new_token()
    user.verification_token_hash = token_hash(raw)
    user.verification_expires_at = datetime.now(UTC) + timedelta(
        hours=settings.verification_token_hours
    )
    return raw


def register(
    session: Session,
    request: Request,
    email: str,
    password: str,
    settings: Settings,
    sender: EmailSender,
) -> User:
    user = User(
        email=email.lower(),
        password_hash=hash_password(password),
        role="agent",
        status="pending",
    )
    raw = issue_verification(user, settings)
    session.add(user)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            409, "Registration cannot be completed for this email"
        ) from None
    audit(session, request, "agent_registered", actor=user)
    session.commit()
    send_token_email(sender, settings, user.email, "verification", raw)
    return user


def verify_email(session: Session, request: Request, raw: str) -> None:
    user = session.scalar(
        select(User)
        .where(User.verification_token_hash == token_hash(raw))
        .with_for_update()
    )
    if (
        user is None
        or user.verification_expires_at is None
        or user.verification_expires_at <= datetime.now(UTC)
    ):
        raise HTTPException(400, "Verification token is invalid or expired")
    user.email_verified_at = datetime.now(UTC)
    user.verification_token_hash = None
    user.verification_expires_at = None
    audit(session, request, "email_verified", actor=user)
    session.commit()


def resend_verification(
    session: Session,
    request: Request,
    email: str,
    settings: Settings,
    sender: EmailSender,
) -> None:
    user = session.scalar(
        select(User).where(User.email == email.lower()).with_for_update()
    )
    if user is not None and user.is_active and user.email_verified_at is None:
        raw = issue_verification(user, settings)
        audit(session, request, "verification_requested", target=user)
        session.commit()
        send_token_email(sender, settings, user.email, "verification", raw)


def forgot_password(
    session: Session,
    request: Request,
    email: str,
    settings: Settings,
    sender: EmailSender,
) -> None:
    user = session.scalar(
        select(User).where(User.email == email.lower()).with_for_update()
    )
    if user is not None and user.is_active:
        session.execute(
            update(PasswordResetToken)
            .where(
                PasswordResetToken.user_id == user.id,
                PasswordResetToken.used_at.is_(None),
            )
            .values(used_at=datetime.now(UTC))
        )
        raw = new_token()
        session.add(
            PasswordResetToken(
                user_id=user.id,
                token_hash=token_hash(raw),
                expires_at=datetime.now(UTC)
                + timedelta(minutes=settings.reset_token_minutes),
            )
        )
        audit(session, request, "password_reset_requested", target=user)
        session.commit()
        send_token_email(sender, settings, user.email, "reset", raw)


def reset_password(session: Session, request: Request, raw: str, password: str) -> None:
    candidate = session.scalar(
        select(PasswordResetToken).where(
            PasswordResetToken.token_hash == token_hash(raw)
        )
    )
    if candidate is None:
        raise HTTPException(400, "Reset token is invalid or expired")
    user = session.scalar(
        select(User).where(User.id == candidate.user_id).with_for_update()
    )
    token = session.scalar(
        select(PasswordResetToken)
        .where(PasswordResetToken.id == candidate.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if (
        token.used_at is not None
        or token.expires_at <= datetime.now(UTC)
        or not user.is_active
    ):
        raise HTTPException(400, "Reset token is invalid or expired")
    token.used_at = datetime.now(UTC)
    user.password_hash = hash_password(password)
    user.failed_login_attempts = 0
    user.locked_until = None
    revoke_sessions(session, user)
    audit(session, request, "password_reset", actor=user)
    session.commit()


def change_password(
    session: Session, request: Request, user: User, current: str, replacement: str
) -> None:
    user = session.scalar(
        select(User)
        .where(User.id == user.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if not verify_password(current, user.password_hash):
        audit(session, request, "password_change", "failure", actor=user)
        session.commit()
        raise HTTPException(400, "Current password is incorrect")
    user.password_hash = hash_password(replacement)
    session.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None)
        )
        .values(used_at=datetime.now(UTC))
    )
    revoke_sessions(session, user)
    audit(session, request, "password_change", actor=user)
    session.commit()
