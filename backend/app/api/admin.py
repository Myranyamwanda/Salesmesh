from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from app.auth import Database, require_roles
from app.core.errors import CodedHTTPException
from app.models import AgentProfile, AuditLog, User
from app.schemas.auth import ActiveInput, CreateUserInput, RoleInput, UserRead
from app.services.agents import create_agent_profile
from app.services.audit import audit
from app.services.auth import other_usable_admins, revoke_sessions
from app.services.firebase import Firebase, FirebaseUnavailable, unavailable

router = APIRouter(prefix="/admin", tags=["Administration"])
type Admin = Annotated[User, Depends(require_roles("admin"))]


class UserPage(BaseModel):
    items: list[UserRead]
    total: int


class AuditRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    actor_user_id: UUID | None
    target_user_id: UUID | None
    subject: str | None
    action: str
    outcome: str
    request_id: str | None
    created_at: datetime


class AuditPage(BaseModel):
    items: list[AuditRead]
    total: int


def get_target(session, user_id):
    user = session.scalar(
        select(User)
        .where(User.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if user is None:
        raise HTTPException(404, "User not found")
    return user


def protect_admin(session, actor, target):
    if actor.id == target.id:
        raise HTTPException(
            400, "Administrators cannot deactivate or change their own role"
        )
    if target.role == "admin" and target.is_active and target.status == "approved":
        if not other_usable_admins(session, target.id):
            raise HTTPException(
                409,
                "At least one other administrator who signs in with Firebase "
                "and an authenticator app must remain",
            )


@router.get("/users", response_model=UserPage)
def list_users(
    request: Request,
    session: Database,
    actor: Admin,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
):
    users = session.scalars(
        select(User).order_by(User.created_at, User.id).offset(offset).limit(limit)
    ).all()
    total = session.scalar(select(func.count()).select_from(User))
    items = [UserRead.model_validate(user) for user in users]
    audit(session, request, "users_listed", actor=actor)
    session.commit()
    return UserPage(items=items, total=total)


@router.get("/users/{user_id}", response_model=UserRead)
def read_user(user_id: UUID, request: Request, session: Database, actor: Admin):
    target = session.get(User, user_id)
    if target is None:
        audit(session, request, "user_viewed", "failure", actor=actor)
        session.commit()
        raise HTTPException(404, "User not found")
    result = UserRead.model_validate(target)
    audit(session, request, "user_viewed", actor=actor, target=target)
    session.commit()
    return result


@router.post("/users", response_model=UserRead, status_code=201)
def create_user(
    payload: CreateUserInput,
    request: Request,
    session: Database,
    actor: Admin,
    firebase: Firebase,
):
    """Create an admin or client in SalesMesh and Firebase, without a password.

    The frontend then asks Firebase to send a password-reset email, which the
    person uses to set their password. Firebase marks the email verified when
    they first sign in through a verified link.
    """
    email = str(payload.email).lower()

    def failed(status: int, message: str) -> HTTPException:
        audit(session, request, "user_created", "failure", actor=actor)
        session.commit()
        return HTTPException(status, message)

    conflict = "Account cannot be created for this email"
    if session.scalar(select(User.id).where(User.email == email)):
        raise failed(409, conflict)
    try:
        uid = firebase.ensure_user(email)
    except FirebaseUnavailable:
        raise failed(503, unavailable().detail) from None
    target = User(email=email, firebase_uid=uid, role=payload.role, status="approved")
    session.add(target)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        raise failed(409, conflict) from None
    audit(session, request, "user_created", actor=actor, target=target)
    session.commit()
    return target


@router.post("/users/{user_id}/password-email", response_model=UserRead)
def prepare_password_email(
    user_id: UUID,
    request: Request,
    session: Database,
    actor: Admin,
    firebase: Firebase,
):
    """Make sure the user has a Firebase account before a password email is sent.

    Firebase emails only accounts that exist. Accounts from before Firebase
    have none, so one is created here without a password and linked. The
    frontend then asks Firebase to send the "set your password" email; the
    person proves they own the address by using it, and signing in still
    requires a verified email.
    """
    target = get_target(session, user_id)

    def failed(status: int, code: str, message: str) -> CodedHTTPException:
        audit(
            session,
            request,
            "password_email_requested",
            "failure",
            actor=actor,
            target=target,
        )
        session.commit()
        return CodedHTTPException(status, code, message)

    if not target.is_active:
        raise failed(409, "account_inactive", "Activate the account first")
    try:
        uid = firebase.ensure_user(target.email)
        # A stored uid whose Firebase account was deleted is replaced.
        stale = target.firebase_uid not in (None, uid) and (
            firebase.email_of(target.firebase_uid) is None
        )
    except FirebaseUnavailable:
        raise failed(503, "firebase_unavailable", unavailable().detail) from None
    if target.firebase_uid is None or stale:
        target.firebase_uid = uid
    elif target.firebase_uid != uid:
        raise failed(
            409,
            "account_link_conflict",
            "This account is linked to a different Firebase user",
        )
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        raise failed(
            409,
            "account_link_conflict",
            "This Firebase user is linked to another account",
        ) from None
    audit(session, request, "password_email_requested", actor=actor, target=target)
    session.commit()
    return target


def change_user(session, request, actor, user_id, action, apply_change):
    session.execute(text("SELECT pg_advisory_xact_lock(71023)"))
    target = None
    try:
        target = get_target(session, user_id)
        apply_change(target)
    except HTTPException:
        audit(session, request, action, "failure", actor=actor, target=target)
        session.commit()
        raise
    revoke_sessions(session, target)
    audit(session, request, action, actor=actor, target=target)
    session.commit()
    return target


@router.post("/users/{user_id}/approve", response_model=UserRead)
def approve_user(user_id: UUID, request: Request, session: Database, actor: Admin):
    def approve(target):
        if target.role != "agent" or target.status != "pending":
            raise HTTPException(409, "Only pending agent accounts can be approved")
        target.status = "approved"

    return change_user(session, request, actor, user_id, "agent_approved", approve)


@router.post("/users/{user_id}/reject", response_model=UserRead)
def reject_user(user_id: UUID, request: Request, session: Database, actor: Admin):
    def reject(target):
        if target.role != "agent" or target.status != "pending":
            raise HTTPException(409, "Only pending agent accounts can be rejected")
        target.status = "rejected"

    return change_user(session, request, actor, user_id, "agent_rejected", reject)


@router.patch("/users/{user_id}/active", response_model=UserRead)
def set_user_active(
    user_id: UUID,
    payload: ActiveInput,
    request: Request,
    session: Database,
    actor: Admin,
    firebase: Firebase,
):
    def apply(target):
        if not payload.is_active:
            protect_admin(session, actor, target)
        # Firebase first: if it fails, nothing changes in SalesMesh either.
        try:
            uid = target.firebase_uid or firebase.find_uid(target.email)
            if uid is not None:
                firebase.set_disabled(uid, not payload.is_active)
        except FirebaseUnavailable:
            raise unavailable() from None
        target.is_active = payload.is_active

    return change_user(session, request, actor, user_id, "user_activity_changed", apply)


@router.patch("/users/{user_id}/role", response_model=UserRead)
def set_user_role(
    user_id: UUID, payload: RoleInput, request: Request, session: Database, actor: Admin
):
    def apply(target):
        protect_admin(session, actor, target)
        target.role = payload.role
        if target.role != "agent":
            target.status = "approved"
        elif session.get(AgentProfile, target.id) is None:
            # A former agent keeps their profile and referral code.
            create_agent_profile(session, target)

    return change_user(session, request, actor, user_id, "user_role_changed", apply)


@router.get("/audit-logs", response_model=AuditPage)
def list_audit_logs(
    session: Database,
    actor: Admin,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
):
    rows = session.scalars(
        select(AuditLog)
        .order_by(AuditLog.created_at.desc(), AuditLog.id)
        .offset(offset)
        .limit(limit)
    ).all()
    total = session.scalar(select(func.count()).select_from(AuditLog))
    return AuditPage(items=[AuditRead.model_validate(row) for row in rows], total=total)
