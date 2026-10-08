from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.security import decode_access_token
from app.db.session import get_db
from app.models import RefreshToken, User
from app.services.auth import active_user, unauthorized

bearer = HTTPBearer(auto_error=False)
type Database = Annotated[Session, Depends(get_db)]
type Configuration = Annotated[Settings, Depends(get_settings)]


def current_user(
    session: Database,
    settings: Configuration,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> User:
    if credentials is None:
        raise unauthorized()
    try:
        claims = decode_access_token(credentials.credentials, settings)
        user_id, session_id = UUID(claims["sub"]), UUID(claims["sid"])
    except jwt.InvalidTokenError, ValueError, TypeError, KeyError:
        raise unauthorized() from None
    user = session.get(User, user_id)
    if (
        user is None
        or not active_user(user)
        or claims["ver"] != user.token_version
        or claims["role"] != user.role
    ):
        raise unauthorized()
    active_session = session.scalar(
        select(RefreshToken.id)
        .where(
            RefreshToken.user_id == user.id,
            RefreshToken.session_id == session_id,
            RefreshToken.revoked_at.is_(None),
            RefreshToken.expires_at > datetime.now(UTC),
        )
        .limit(1)
    )
    if active_session is None:
        raise unauthorized()
    return user


type AuthenticatedUser = Annotated[User, Depends(current_user)]


def require_roles(*roles: str):
    def check_role(user: AuthenticatedUser) -> User:
        if user.role not in roles:
            raise HTTPException(403, "You do not have permission for this action")
        return user

    return check_role


def require_cookie_origin(request: Request, settings: Configuration) -> None:
    if request.headers.get("origin") != settings.frontend_url:
        raise HTTPException(403, "Trusted Origin header is required")
