from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response

from app.auth import AuthenticatedUser, Configuration, Database, require_cookie_origin
from app.schemas.auth import (
    AccessTokenResponse,
    ChangePasswordInput,
    EmailInput,
    LoginInput,
    MessageResponse,
    RegistrationInput,
    ResetPasswordInput,
    TokenInput,
    UserRead,
)
from app.services import auth
from app.services.audit import audit
from app.services.email import EmailSender, get_email_sender

router = APIRouter(prefix="/auth", tags=["Authentication"])
type Sender = Annotated[EmailSender, Depends(get_email_sender)]
COOKIE_NAME = "salesmesh_refresh"
COOKIE_PATH = "/auth"


def set_refresh_cookie(response: Response, token: str, max_age: int) -> None:
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=max_age,
        httponly=True,
        secure=True,
        samesite="strict",
        path=COOKIE_PATH,
    )


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        COOKIE_NAME, path=COOKIE_PATH, httponly=True, secure=True, samesite="strict"
    )


@router.post("/register", response_model=UserRead, status_code=201)
def register(
    payload: RegistrationInput,
    request: Request,
    session: Database,
    settings: Configuration,
    sender: Sender,
):
    return auth.register(
        session,
        request,
        str(payload.email),
        payload.password.get_secret_value(),
        settings,
        sender,
    )


@router.post("/login", response_model=AccessTokenResponse)
def login(
    payload: LoginInput,
    request: Request,
    response: Response,
    session: Database,
    settings: Configuration,
):
    encoded, raw = auth.login(
        session,
        request,
        str(payload.email),
        payload.password.get_secret_value(),
        settings,
    )
    set_refresh_cookie(response, raw, settings.refresh_token_days * 86400)
    response.headers["Cache-Control"] = "no-store"
    return AccessTokenResponse(
        access_token=encoded, expires_in=settings.access_token_minutes * 60
    )


@router.post(
    "/refresh",
    response_model=AccessTokenResponse,
    dependencies=[Depends(require_cookie_origin)],
)
def refresh(
    request: Request, response: Response, session: Database, settings: Configuration
):
    raw = request.cookies.get(COOKIE_NAME)
    if not raw:
        raise auth.unauthorized()
    encoded, replacement, max_age = auth.refresh(session, request, raw, settings)
    set_refresh_cookie(response, replacement, max_age)
    response.headers["Cache-Control"] = "no-store"
    return AccessTokenResponse(
        access_token=encoded, expires_in=settings.access_token_minutes * 60
    )


@router.post(
    "/logout",
    response_model=MessageResponse,
    dependencies=[Depends(require_cookie_origin)],
)
def logout(request: Request, response: Response, session: Database):
    auth.logout(session, request, request.cookies.get(COOKIE_NAME))
    clear_refresh_cookie(response)
    return MessageResponse(message="Logged out")


@router.post("/logout-all", response_model=MessageResponse)
def logout_all(
    request: Request, response: Response, session: Database, user: AuthenticatedUser
):
    auth.revoke_sessions(session, user)
    audit(session, request, "logout_all", actor=user)
    session.commit()
    clear_refresh_cookie(response)
    return MessageResponse(message="All sessions logged out")


@router.get("/me", response_model=UserRead)
def me(response: Response, user: AuthenticatedUser):
    response.headers["Cache-Control"] = "no-store"
    return user


@router.post("/verify-email", response_model=MessageResponse)
def verify_email(payload: TokenInput, request: Request, session: Database):
    auth.verify_email(session, request, payload.token)
    return MessageResponse(message="Email verified")


@router.post("/resend-verification", response_model=MessageResponse)
def resend_verification(
    payload: EmailInput,
    request: Request,
    session: Database,
    settings: Configuration,
    sender: Sender,
):
    auth.resend_verification(session, request, str(payload.email), settings, sender)
    return MessageResponse(message="If eligible, a verification email has been sent")


@router.post("/forgot-password", response_model=MessageResponse)
def forgot_password(
    payload: EmailInput,
    request: Request,
    session: Database,
    settings: Configuration,
    sender: Sender,
):
    auth.forgot_password(session, request, str(payload.email), settings, sender)
    return MessageResponse(message="If eligible, a password reset email has been sent")


@router.post("/reset-password", response_model=MessageResponse)
def reset_password(
    payload: ResetPasswordInput, request: Request, response: Response, session: Database
):
    auth.reset_password(
        session, request, payload.token, payload.password.get_secret_value()
    )
    clear_refresh_cookie(response)
    return MessageResponse(message="Password reset; sign in again")


@router.post("/change-password", response_model=MessageResponse)
def change_password(
    payload: ChangePasswordInput,
    request: Request,
    response: Response,
    session: Database,
    user: AuthenticatedUser,
):
    auth.change_password(
        session,
        request,
        user,
        payload.current_password.get_secret_value(),
        payload.new_password.get_secret_value(),
    )
    clear_refresh_cookie(response)
    return MessageResponse(message="Password changed; sign in again")
