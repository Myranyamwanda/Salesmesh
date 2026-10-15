from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ModelVersion(Base):
    """A model version that has been loaded; exactly one can be active."""

    __tablename__ = "model_versions"
    __table_args__ = (
        Index(
            "uq_model_versions_one_active",
            "active",
            unique=True,
            postgresql_where=text("active"),
        ),
    )

    version: Mapped[str] = mapped_column(String(50), primary_key=True)
    loaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    metrics: Mapped[dict[str, Any]] = mapped_column(JSONB)
    active: Mapped[bool] = mapped_column(Boolean, server_default="false")


class RiskAssessment(Base):
    """One model score for one customer, with the inputs that produced it."""

    __tablename__ = "risk_assessments"
    __table_args__ = (
        CheckConstraint("probability >= 0 AND probability <= 1", name="probability"),
        CheckConstraint("threshold >= 0 AND threshold <= 1", name="threshold"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    # CASCADE: erasing a customer (Data Protection Act) erases their scores.
    customer_id: Mapped[UUID] = mapped_column(
        ForeignKey("customers.id", ondelete="CASCADE"), index=True
    )
    model_version: Mapped[str] = mapped_column(
        ForeignKey("model_versions.version", ondelete="RESTRICT")
    )
    probability: Mapped[float] = mapped_column(Float)
    threshold: Mapped[float] = mapped_column(Float)
    flagged: Mapped[bool] = mapped_column(Boolean, index=True)
    reasons: Mapped[list[Any]] = mapped_column(JSONB)
    features: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Review(Base):
    """An admin's final decision on a flagged assessment (one per assessment)."""

    __tablename__ = "reviews"
    __table_args__ = (
        CheckConstraint(
            "decision IN ('confirmed_real', 'confirmed_fake')", name="decision"
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    assessment_id: Mapped[UUID] = mapped_column(
        ForeignKey("risk_assessments.id", ondelete="CASCADE"), unique=True
    )
    reviewer_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    decision: Mapped[str] = mapped_column(String(20))
    notes: Mapped[str | None] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class ScoringConfig(Base):
    """Reputation settings. The table always holds exactly one row (id = 1)."""

    __tablename__ = "scoring_config"
    __table_args__ = (
        CheckConstraint("id = 1", name="single_row"),
        CheckConstraint("p0 > 0 AND p0 < 1", name="p0"),
        CheckConstraint("k > 0", name="k"),
        CheckConstraint("min_users_for_band >= 1", name="min_users_for_band"),
        CheckConstraint(
            "high_risk_below >= 0 AND high_risk_below <= watch_below "
            "AND watch_below <= 100",
            name="band_order",
        ),
        # Must stay above the training max of device_distinct_emails_8w (2.0).
        CheckConstraint("device_email_rule_min >= 3", name="device_email_rule_min"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    p0: Mapped[float] = mapped_column(Float, server_default="0.0539")
    k: Mapped[float] = mapped_column(Float, server_default="10")
    min_users_for_band: Mapped[int] = mapped_column(Integer, server_default="30")
    high_risk_below: Mapped[float] = mapped_column(Float, server_default="90")
    watch_below: Mapped[float] = mapped_column(Float, server_default="92")
    # Rule: flag when one device registered at least this many distinct emails
    # in 8 weeks, a level the model never saw in training.
    device_email_rule_min: Mapped[int] = mapped_column(Integer, server_default="3")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
