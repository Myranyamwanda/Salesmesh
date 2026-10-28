import hashlib
import hmac
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi import HTTPException, Request
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import CodedHTTPException
from app.core.security import access_token, new_token, token_hash
from app.models import AuditLog, RefreshToken, User
from app.services import mfa
from app.services.agents import create_agent_profile
from app.services.audit import audit
from app.services.email_checks import check_permanent_email
from app.services.firebase import (
    FirebaseAuth,
    FirebaseIdentity,
    FirebaseUnavailable,
    InvalidFirebaseToken,
    unavailable,
)

INACTIVE_MESSAGE = "This account cannot sign in. Contact an administrator."


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


def other_usable_admins(session: Session, user_id) -> int:
    """Admins other than user_id who can actually sign in today.

    Usable means active, approved, verified, linked to Firebase, and with an
    authenticator app set up. An admin with an undeliverable email (who can
    never sign in through Firebase) does not count.
    """
    return session.scalar(
        select(func.count())
        .select_from(User)
        .where(
            User.role == "admin",
            User.is_active.is_(True),
            User.status == "approved",
            User.email_verified_at.is_not(None),
            User.firebase_uid.is_not(None),
            User.totp_enabled_at.is_not(None),
            User.id != user_id,
        )
    )


def client_address(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def hash_ip(address: str, settings: Settings) -> str:
    """HMAC-SHA256 of an IP address, so raw addresses are never stored."""
    return hmac.new(
        settings.signing_key().encode(), address.encode(), hashlib.sha256
    ).hexdigest()


def check_login_rate(session: Session, request: Request, settings: Settings) -> str:
    hashed = hash_ip(client_address(request), settings)
    lock_key = int(hashed[:15], 16)
    session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})
    since = datetime.now(UTC) - timedelta(seconds=settings.login_rate_window_seconds)
    attempts = session.scalar(
        select(func.count())
        .select_from(AuditLog)
        .where(
            AuditLog.client_ip_hash == hashed,
            AuditLog.action.in_(["login_success", "login_failure", "mfa_failure"]),
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


def start_session(
    session: Session, request: Request, user: User, settings: Settings, source: str
):
    """Issue the SalesMesh access token and refresh token after a successful login."""
    raw = new_token()
    session_id = uuid4()
    session.add(
        RefreshToken(
            user_id=user.id,
            session_id=session_id,
            token_hash=token_hash(raw),
            expires_at=datetime.now(UTC) + timedelta(days=settings.refresh_token_days),
        )
    )
    encoded = access_token(user, session_id, settings)
    audit(session, request, "login_success", actor=user, client_ip_hash=source)
    session.commit()
    return encoded, raw


def verified_identity(firebase: FirebaseAuth, id_token: str) -> FirebaseIdentity:
    """Check a Firebase ID token; raise the HTTP error the caller should return."""
    try:
        identity = firebase.verify(id_token)
    except InvalidFirebaseToken as exc:
        if exc.reason == "disabled":
            raise CodedHTTPException(
                403, "account_inactive", INACTIVE_MESSAGE
            ) from None
        raise unauthorized() from None
    except FirebaseUnavailable:
        raise unavailable() from None
    if identity.email is None:
        raise unauthorized()
    if not identity.email_verified:
        raise CodedHTTPException(
            403,
            "email_not_verified",
            "Verify your email address using the link we sent, then sign in again",
        )
    return identity


def find_firebase_user(session: Session, identity: FirebaseIdentity) -> User | None:
    """The SalesMesh user for a Firebase identity: by Firebase uid, else by email."""
    user = session.scalar(
        select(User).where(User.firebase_uid == identity.uid).with_for_update()
    )
    if user is None:
        user = session.scalar(
            select(User).where(User.email == identity.email).with_for_update()
        )
    return user


def firebase_login(
    session: Session,
    request: Request,
    id_token: str,
    settings: Settings,
    firebase: FirebaseAuth,
):
    """Exchange a Firebase ID token for SalesMesh tokens, or for an MFA challenge.

    Firebase proves who the person is; the existing SalesMesh rules (active,
    approved, role) decide whether they get the usual access and refresh tokens.
    Admins must first enter a TOTP code (see app/services/mfa.py).

    Returns (access token, refresh token, None), or (None, None, MFA challenge)
    for an admin.
    """
    source = check_login_rate(session, request, settings)

    def failure(error: HTTPException, user: User | None = None) -> HTTPException:
        audit(
            session,
            request,
            "login_failure",
            "failure",
            target=user,
            client_ip_hash=source,
        )
        session.commit()
        return error

    try:
        identity = verified_identity(firebase, id_token)
    except HTTPException as exc:
        if exc.status_code == 503:
            session.rollback()
            raise
        raise failure(exc) from None
    user = find_firebase_user(session, identity)
    if user is None:
        raise failure(
            CodedHTTPException(
                404, "account_not_found", "No SalesMesh account uses this email"
            )
        )
    if user.firebase_uid not in (None, identity.uid):
        raise failure(
            CodedHTTPException(
                409,
                "account_link_conflict",
                "This account is linked to a different sign-in. "
                "Contact an administrator.",
            ),
            user,
        )
    # Firebase has verified this email, so link the account and record it.
    user.firebase_uid = identity.uid
    if user.email_verified_at is None:
        user.email_verified_at = datetime.now(UTC)
    if not user.is_active or user.status == "rejected":
        raise failure(
            CodedHTTPException(403, "account_inactive", INACTIVE_MESSAGE), user
        )
    if user.status == "pending":
        raise failure(
            CodedHTTPException(
                403,
                "account_pending",
                "Your agent account is awaiting administrator approval",
            ),
            user,
        )
    if user.role == "admin":
        return None, None, mfa.challenge(session, request, user, settings, source)
    return *start_session(session, request, user, settings, source), None


def mfa_setup(session: Session, request: Request, mfa_token: str, settings: Settings):
    """Start authenticator setup for an admin who has none yet."""
    user = mfa.mfa_user(session, mfa_token, settings)
    secret, uri = mfa.begin_setup(user, settings)
    audit(session, request, "mfa_setup_started", actor=user)
    session.commit()
    return secret, uri


def mfa_complete(
    session: Session,
    request: Request,
    mfa_token: str,
    code: str,
    settings: Settings,
    setup: bool,
):
    """Finish an admin sign-in with a TOTP code or, outside setup, a recovery code.

    In setup, the first correct code turns TOTP on and returns new recovery codes.
    Wrong codes count towards the account lockout (LOGIN_FAILURE_LIMIT).
    """
    source = check_login_rate(session, request, settings)
    user = mfa.mfa_user(session, mfa_token, settings)
    mfa.check_not_locked(user)
    if setup and user.totp_enabled_at is not None:
        raise CodedHTTPException(
            409, "mfa_already_enabled", "An authenticator app is already set up"
        )
    if not setup and user.totp_enabled_at is None:
        raise CodedHTTPException(
            409, "mfa_setup_required", "Set up an authenticator app first"
        )
    step = mfa.matching_step(user, code, settings)
    recovery_codes = None
    if step is not None and setup:
        recovery_codes = mfa.enable_totp(session, user, step)
        audit(session, request, "mfa_enabled", actor=user)
    elif step is not None:
        user.totp_last_step = step
    elif not setup and mfa.use_recovery_code(session, user, code):
        audit(session, request, "mfa_recovery_code_used", actor=user)
    else:
        mfa.record_failure(user, settings)
        audit(
            session,
            request,
            "mfa_failure",
            "failure",
            target=user,
            client_ip_hash=source,
        )
        session.commit()
        raise CodedHTTPException(401, "mfa_invalid_code", "That code is not correct")
    user.failed_login_attempts = 0
    user.locked_until = None
    encoded, raw = start_session(session, request, user, settings, source)
    return encoded, raw, recovery_codes


def firebase_register(
    session: Session,
    request: Request,
    id_token: str,
    display_name: str,
    settings: Settings,
    firebase: FirebaseAuth,
) -> User:
    """Create a pending agent for a verified Firebase user (agents only).

    The email must also pass the real-email checks (not disposable, has MX).
    """
    identity = verified_identity(firebase, id_token)
    check_permanent_email(identity.email, settings)
    exists = CodedHTTPException(
        409, "account_exists", "An account already uses this email; sign in instead"
    )
    if find_firebase_user(session, identity) is not None:
        audit(session, request, "agent_registered", "failure")
        session.commit()
        raise exists
    user = User(
        email=identity.email,
        firebase_uid=identity.uid,
        role="agent",
        status="pending",
        email_verified_at=datetime.now(UTC),
    )
    session.add(user)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        raise exists from None
    create_agent_profile(session, user, display_name)
    audit(session, request, "agent_registered", actor=user)
    session.commit()
    return user


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
