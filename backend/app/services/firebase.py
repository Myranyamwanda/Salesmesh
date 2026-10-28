"""Firebase Authentication: the only module that talks to Firebase.

Firebase proves who someone is (sign-in, email verification, password resets);
SalesMesh decides what they may do (roles, approval, sessions). Tests replace
FirebaseAuth with a fake through the get_firebase dependency, so they never use
the network.
"""

import logging
from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated

import firebase_admin
from fastapi import Depends, HTTPException
from firebase_admin import auth, credentials, exceptions

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)
APP_NAME = "salesmesh"


@dataclass(frozen=True)
class FirebaseIdentity:
    uid: str
    email: str | None
    email_verified: bool


class InvalidFirebaseToken(Exception):
    """The ID token cannot be used. reason: "invalid", "revoked", or "disabled"."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class FirebaseUnavailable(Exception):
    """Firebase could not be reached or refused the request."""


class FirebaseAuth:
    def __init__(self, app: firebase_admin.App) -> None:
        self.app = app

    def verify(self, id_token: str) -> FirebaseIdentity:
        try:
            claims = auth.verify_id_token(id_token, app=self.app, check_revoked=True)
        except auth.RevokedIdTokenError:
            raise InvalidFirebaseToken("revoked") from None
        except auth.UserDisabledError:
            raise InvalidFirebaseToken("disabled") from None
        except auth.InvalidIdTokenError, ValueError:
            raise InvalidFirebaseToken("invalid") from None
        except exceptions.FirebaseError as exc:
            raise FirebaseUnavailable(type(exc).__name__) from None
        email = claims.get("email")
        return FirebaseIdentity(
            uid=claims["uid"],
            email=email.lower() if email else None,
            email_verified=bool(claims.get("email_verified")),
        )

    def find_uid(self, email: str) -> str | None:
        try:
            return auth.get_user_by_email(email, app=self.app).uid
        except auth.UserNotFoundError:
            return None
        except exceptions.FirebaseError as exc:
            raise FirebaseUnavailable(type(exc).__name__) from None

    def ensure_user(self, email: str) -> str:
        """Return the uid of the Firebase user with this email, creating it if needed.

        A new user has no password; the person sets one from a reset email.
        """
        try:
            return auth.create_user(email=email, email_verified=False, app=self.app).uid
        except auth.EmailAlreadyExistsError:
            return self.find_uid(email)
        except exceptions.FirebaseError as exc:
            raise FirebaseUnavailable(type(exc).__name__) from None

    def upsert_password_user(self, email: str, password: str) -> tuple[str, bool]:
        """Create a verified password user, or update the existing one.

        Returns (uid, created). Used only by the demo seed, whose accounts all
        share a published password.
        """
        try:
            user = auth.create_user(
                email=email, password=password, email_verified=True, app=self.app
            )
            return user.uid, True
        except auth.EmailAlreadyExistsError:
            uid = self.find_uid(email)
        except exceptions.FirebaseError as exc:
            raise FirebaseUnavailable(type(exc).__name__) from None
        try:
            auth.update_user(
                uid,
                password=password,
                email_verified=True,
                disabled=False,
                app=self.app,
            )
        except exceptions.FirebaseError as exc:
            raise FirebaseUnavailable(type(exc).__name__) from None
        return uid, False

    def email_of(self, uid: str) -> str | None:
        """The email of a Firebase user, or None when the uid does not exist."""
        try:
            email = auth.get_user(uid, app=self.app).email
        except auth.UserNotFoundError:
            return None
        except exceptions.FirebaseError as exc:
            raise FirebaseUnavailable(type(exc).__name__) from None
        return email.lower() if email else None

    def delete_user(self, uid: str) -> None:
        try:
            auth.delete_user(uid, app=self.app)
        except auth.UserNotFoundError:
            return
        except exceptions.FirebaseError as exc:
            raise FirebaseUnavailable(type(exc).__name__) from None

    def password_reset_link(self, email: str) -> str:
        """A one-time Firebase link to set the password, for printing in a terminal."""
        try:
            return auth.generate_password_reset_link(email, app=self.app)
        except exceptions.FirebaseError as exc:
            raise FirebaseUnavailable(type(exc).__name__) from None

    def set_disabled(self, uid: str, disabled: bool) -> None:
        """Disable or enable sign-in; disabling also ends Firebase sessions."""
        try:
            auth.update_user(uid, disabled=disabled, app=self.app)
            if disabled:
                auth.revoke_refresh_tokens(uid, app=self.app)
        except auth.UserNotFoundError:
            return
        except exceptions.FirebaseError as exc:
            raise FirebaseUnavailable(type(exc).__name__) from None


@lru_cache
def firebase_client(credentials_path: str, project_id: str) -> FirebaseAuth:
    try:
        app = firebase_admin.get_app(APP_NAME)
    except ValueError:
        app = firebase_admin.initialize_app(
            credentials.Certificate(credentials_path),
            {"projectId": project_id},
            name=APP_NAME,
        )
    return FirebaseAuth(app)


def firebase_from_settings(settings: Settings) -> FirebaseAuth:
    """The Firebase client, or RuntimeError when it is not configured."""
    if not settings.firebase_project_id or not settings.firebase_credentials_path:
        raise RuntimeError(
            "Set FIREBASE_PROJECT_ID and FIREBASE_CREDENTIALS_PATH in .env"
        )
    try:
        return firebase_client(
            str(settings.firebase_credentials_path), settings.firebase_project_id
        )
    except (OSError, ValueError) as exc:
        # The message names the problem without printing the key's contents.
        raise RuntimeError(
            f"Cannot load the Firebase credentials file ({type(exc).__name__})"
        ) from None


def get_firebase(settings: Annotated[Settings, Depends(get_settings)]) -> FirebaseAuth:
    try:
        return firebase_from_settings(settings)
    except RuntimeError as exc:
        logger.error("firebase_not_configured", extra={"reason": str(exc)})
        raise HTTPException(503, "Sign-in is not configured") from None


type Firebase = Annotated[FirebaseAuth, Depends(get_firebase)]


def unavailable() -> HTTPException:
    return HTTPException(503, "The sign-in service is unavailable; try again shortly")
