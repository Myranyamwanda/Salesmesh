from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.agent import REFERRAL_ALPHABET

# A registration reference such as SM-7K3Q-9XPA, shown to the customer.
REFERENCE_PREFIX = "SM-"
REFERENCE_GROUP_LENGTH = 4
# The consent wording the customer agreed to. 1 = SalesMesh only (v1.0-v1.1);
# 2 = details are also shared with the agent's client for onboarding (v1.2).
# Change it together with the consent text in frontend/src/pages/JoinPage.tsx.
CONSENT_VERSION = 2


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
        CheckConstraint(
            f"reference ~ '^{REFERENCE_PREFIX}[{REFERRAL_ALPHABET}]"
            f"{{{REFERENCE_GROUP_LENGTH}}}-[{REFERRAL_ALPHABET}]"
            f"{{{REFERENCE_GROUP_LENGTH}}}$'",
            name="reference_format",
        ),
        CheckConstraint("consent_version >= 1", name="consent_version"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    # RESTRICT: an agent with customers cannot be deleted by accident.
    agent_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    # The client the agent worked for at registration: the client the customer
    # consented to share their details with. Later reassignment does not move it.
    client_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    reference: Mapped[str] = mapped_column(String(12), unique=True)
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
    consent_version: Mapped[int] = mapped_column(SmallInteger)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
