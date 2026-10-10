from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from app.auth import Configuration, Database, require_roles
from app.core.security import hash_password
from app.models import AuditLog, User
from app.schemas.auth import ActiveInput, CreateUserInput, RoleInput, UserRead
from app.services.audit import audit
from app.services.auth import issue_verification, revoke_sessions
from app.services.email import EmailSender, get_email_sender, send_token_email

router = APIRouter(prefix="/admin", tags=["Administration"])
type Admin = Annotated[User, Depends(require_roles("admin"))]
type Sender = Annotated[EmailSender, Depends(get_email_sender)]


class UserPage(BaseModel):
    items: list[UserRead]
    total: int


class AuditRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    actor_user_id: UUID | None
    target_user_id: UUID | None
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
        others = session.scalar(
            select(func.count())
            .select_from(User)
            .where(
                User.role == "admin",
                User.is_active.is_(True),
                User.status == "approved",
                User.id != target.id,
                User.email_verified_at.is_not(None),
            )
        )
        if not others:
            raise HTTPException(
                409, "At least one verified active administrator must remain"
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
    settings: Configuration,
    sender: Sender,
):
    target = User(
        email=str(payload.email).lower(),
        password_hash=hash_password(payload.password.get_secret_value()),
        role=payload.role,
        status="approved",
    )
    raw = issue_verification(target, settings)
    session.add(target)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        audit(session, request, "user_created", "failure", actor=actor)
        session.commit()
        raise HTTPException(409, "Account cannot be created for this email") from None
    audit(session, request, "user_created", actor=actor, target=target)
    session.commit()
    send_token_email(sender, settings, target.email, "verification", raw)
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
):
    def apply(target):
        if not payload.is_active:
            protect_admin(session, actor, target)
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
