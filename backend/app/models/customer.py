from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Customer(Base):
    """A person registered through an agent's referral link."""

    __tablename__ = "customers"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending_review', 'verified', 'rejected')", name="status"
        ),
        CheckConstraint("email = lower(email)", name="email_lowercase"),
        CheckConstraint("country ~ '^[A-Z]{2}$'", name="country_code"),
        CheckConstraint("current_address_months >= 0", name="current_address_months"),
        CheckConstraint("previous_address_months >= 0", name="previous_address_months"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    # RESTRICT: an agent with customers cannot be deleted by accident.
    agent_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    full_name: Mapped[str] = mapped_column(String(200))
    # Not unique: the same email registering again is itself a fraud signal.
    email: Mapped[str] = mapped_column(String(320), index=True)
    mobile_phone: Mapped[str] = mapped_column(String(32))
    secondary_phone: Mapped[str | None] = mapped_column(String(32))
    # Collected only for the date_of_birth_distinct_emails_4w feature.
    date_of_birth: Mapped[date] = mapped_column(Date, index=True)
    country: Mapped[str] = mapped_column(String(2))
    current_address_months: Mapped[int] = mapped_column(Integer)
    previous_address_months: Mapped[int | None] = mapped_column(Integer)
    device_id: Mapped[UUID | None] = mapped_column(Uuid, index=True)
    # HMAC-SHA256 of the request IP; the raw address is never stored.
    ip_address_hash: Mapped[str | None] = mapped_column(String(64))
    assisted: Mapped[bool] = mapped_column(Boolean, server_default="false")
    status: Mapped[str] = mapped_column(String(20), server_default="pending_review")
    consent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
