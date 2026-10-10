import logging
from typing import Protocol
from urllib.parse import urlencode

from app.core.config import Settings

logger = logging.getLogger("salesmesh.development_email")


class EmailSender(Protocol):
    def send(self, recipient: str, subject: str, link: str) -> None: ...


class DevelopmentEmailSender:
    def send(self, recipient: str, subject: str, link: str) -> None:
        logger.info(
            "DEVELOPMENT EMAIL to=%s subject=%s link=%s", recipient, subject, link
        )


def get_email_sender() -> EmailSender:
    return DevelopmentEmailSender()


def send_token_email(
    sender: EmailSender, settings: Settings, email: str, kind: str, token: str
) -> None:
    route = "verify-email" if kind == "verification" else "reset-password"
    sender.send(
        email,
        "Verify your email" if kind == "verification" else "Reset your password",
        f"{settings.frontend_url}/{route}?{urlencode({'token': token})}",
    )
