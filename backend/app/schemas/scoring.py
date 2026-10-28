from datetime import date, datetime
from typing import Any, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.auth import DisplayName
from app.services.pipeline import RegistrationStatus

type Decision = Literal["confirmed_real", "confirmed_fake"]
type CustomerStatus = Literal["pending_review", "verified", "rejected"]


class AgentSummary(BaseModel):
    id: UUID
    display_name: str


class ReviewInput(BaseModel):
    decision: Decision
    notes: str | None = Field(default=None, max_length=1000)


class ReviewRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    decision: Decision
    notes: str | None
    reviewer_id: UUID | None
    created_at: datetime


class QueueItem(BaseModel):
    assessment_id: UUID
    created_at: datetime
    probability: float
    threshold: float
    reasons: list[dict[str, Any]]
    customer_name: str
    agent: AgentSummary


class QueuePage(BaseModel):
    items: list[QueueItem]
    total: int


class CustomerDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    reference: str
    full_name: str
    email: str
    mobile_phone: str
    secondary_phone: str | None
    date_of_birth: date
    country: str
    current_address_months: int
    previous_address_months: int | None
    assisted: bool
    status: CustomerStatus
    created_at: datetime


class AssessmentDetail(BaseModel):
    id: UUID
    model_version: str
    probability: float
    threshold: float
    flagged: bool
    reasons: list[dict[str, Any]]
    features: dict[str, Any]
    created_at: datetime
    customer: CustomerDetail
    registration_status: RegistrationStatus
    agent: AgentSummary
    review: ReviewRead | None


class ClientSummary(BaseModel):
    id: UUID
    email: str
    organisation_name: str | None


class AgentRanking(BaseModel):
    id: UUID
    display_name: str
    email: str
    referral_code: str
    status: str
    is_active: bool
    client: ClientSummary | None
    # False when customers cannot use the referral link (see link_is_active).
    link_active: bool
    n_users: int
    flags: int
    confirmed_fake: int
    pending_review: int
    assisted_share: float
    reputation: float
    risk_score: float
    band: str


class AgentCustomer(BaseModel):
    id: UUID
    reference: str
    full_name: str
    created_at: datetime
    status: CustomerStatus
    registration_status: RegistrationStatus
    assisted: bool
    assessment_id: UUID | None
    probability: float | None
    flagged: bool | None


class AgentDetail(AgentRanking):
    customers: list[AgentCustomer]
    customers_total: int


class AgentProfileUpdate(BaseModel):
    """Only the fields that are sent are changed; client_id null unassigns."""

    display_name: DisplayName | None = None
    client_id: UUID | None = None


class ScoringConfigInput(BaseModel):
    """Mirrors the CHECK constraints on scoring_config, so errors are a 422."""

    p0: float = Field(gt=0, lt=1)
    k: float = Field(gt=0)
    min_users_for_band: int = Field(ge=1)
    high_risk_below: float = Field(ge=0, le=100)
    watch_below: float = Field(ge=0, le=100)
    # Must stay above the training max of device_distinct_emails_8w (2).
    device_email_rule_min: int = Field(ge=3)

    @model_validator(mode="after")
    def check_band_order(self) -> Self:
        if self.high_risk_below > self.watch_below:
            raise ValueError("high_risk_below must not exceed watch_below")
        return self


class ScoringConfigRead(ScoringConfigInput):
    model_config = ConfigDict(from_attributes=True)
    updated_at: datetime
    updated_by: UUID | None


class EraseInput(BaseModel):
    """The customer's email, typed by the admin to confirm the erasure."""

    confirm_email: str = Field(min_length=1, max_length=320)
