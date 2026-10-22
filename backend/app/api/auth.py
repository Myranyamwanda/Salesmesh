from fastapi import APIRouter, Depends, Request, Response

from app.auth import AuthenticatedUser, Configuration, Database, require_cookie_origin
from app.schemas.auth import (
    AccessTokenResponse,
    FirebaseRegistrationInput,
    FirebaseTokenInput,
    MessageResponse,
    MfaChallengeResponse,
    MfaCodeInput,
    MfaEnabledResponse,
    MfaSetupResponse,
    MfaTokenInput,
    UserRead,
)
from app.services import auth
from app.services.audit import audit
from app.services.firebase import Firebase

router = APIRouter(prefix="/auth", tags=["Authentication"])
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


def token_response(response: Response, encoded: str, raw: str, settings):
    set_refresh_cookie(response, raw, settings.refresh_token_days * 86400)
    response.headers["Cache-Control"] = "no-store"
    return AccessTokenResponse(
        access_token=encoded, expires_in=settings.access_token_minutes * 60
    )


@router.post("/firebase", response_model=AccessTokenResponse | MfaChallengeResponse)
def firebase_login(
    payload: FirebaseTokenInput,
    request: Request,
    response: Response,
    session: Database,
    settings: Configuration,
    firebase: Firebase,
):
    encoded, raw, challenge = auth.firebase_login(
        session, request, payload.id_token, settings, firebase
    )
    if challenge is not None:
        response.headers["Cache-Control"] = "no-store"
        return MfaChallengeResponse(**challenge)
    return token_response(response, encoded, raw, settings)


@router.post("/mfa/setup", response_model=MfaSetupResponse)
def mfa_setup(
    payload: MfaTokenInput,
    request: Request,
    response: Response,
    session: Database,
    settings: Configuration,
):
    secret, uri = auth.mfa_setup(session, request, payload.mfa_token, settings)
    response.headers["Cache-Control"] = "no-store"
    return MfaSetupResponse(secret=secret, otpauth_uri=uri)


@router.post("/mfa/setup/confirm", response_model=MfaEnabledResponse)
def mfa_setup_confirm(
    payload: MfaCodeInput,
    request: Request,
    response: Response,
    session: Database,
    settings: Configuration,
):
    encoded, raw, codes = auth.mfa_complete(
        session, request, payload.mfa_token, payload.code, settings, setup=True
    )
    tokens = token_response(response, encoded, raw, settings)
    return MfaEnabledResponse(**tokens.model_dump(), recovery_codes=codes)


@router.post("/mfa/verify", response_model=AccessTokenResponse)
def mfa_verify(
    payload: MfaCodeInput,
    request: Request,
    response: Response,
    session: Database,
    settings: Configuration,
):
    encoded, raw, _ = auth.mfa_complete(
        session, request, payload.mfa_token, payload.code, settings, setup=False
    )
    return token_response(response, encoded, raw, settings)


@router.post("/firebase/register", response_model=UserRead, status_code=201)
def firebase_register(
    payload: FirebaseRegistrationInput,
    request: Request,
    session: Database,
    settings: Configuration,
    firebase: Firebase,
):
    return auth.firebase_register(
        session, request, payload.id_token, payload.display_name, settings, firebase
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
