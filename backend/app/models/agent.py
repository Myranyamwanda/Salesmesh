from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# Digits and capitals without the look-alikes 0, O, 1, I, and L.
REFERRAL_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
REFERRAL_PREFIX = "AGT-"
REFERRAL_LENGTH = 8


class AgentProfile(Base):
    """Agent-only details. Authentication data stays in users."""

    __tablename__ = "agent_profiles"
    __table_args__ = (
        CheckConstraint(
            f"referral_code ~ '^{REFERRAL_PREFIX}[{REFERRAL_ALPHABET}]"
            f"{{{REFERRAL_LENGTH}}}$'",
            name="referral_code_format",
        ),
        CheckConstraint("length(trim(display_name)) > 0", name="display_name"),
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    referral_code: Mapped[str] = mapped_column(String(12), unique=True)
    display_name: Mapped[str] = mapped_column(String(100))
    # Each agent works for at most one client; the client sees only their
    # agents' customers.
    client_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
