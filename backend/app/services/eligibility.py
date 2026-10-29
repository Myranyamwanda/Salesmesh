"""Commission eligibility: the input SalesMesh gives a commission module.

    clear or verified   -> eligible       (a successful onboarding)
    under_review        -> pending        (flagged, waiting for an admin)
    rejected            -> not_eligible   (an admin confirmed it as fake)

SalesMesh calculates no amounts and makes no payments (SRS 3.7): it only says
which registrations may count towards commission, so a payout module can
"prevent payouts for unverified or rejected onboardings". "received" (not yet
scored) is pending too, so nothing is eligible before it has been checked.
"""

from dataclasses import dataclass, field
from datetime import date
from typing import Literal
from uuid import UUID

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.models import Customer, Review, RiskAssessment
from app.services.periods import utc_month
from app.services.pipeline import (
    CLEAR,
    RECEIVED,
    REJECTED,
    UNDER_REVIEW,
    VERIFIED,
    registration_status_sql,
)

type Eligibility = Literal["eligible", "pending", "not_eligible"]

ELIGIBLE = "eligible"
PENDING = "pending"
NOT_ELIGIBLE = "not_eligible"

ELIGIBILITY = {
    CLEAR: ELIGIBLE,
    VERIFIED: ELIGIBLE,
    RECEIVED: PENDING,
    UNDER_REVIEW: PENDING,
    REJECTED: NOT_ELIGIBLE,
}


def eligibility(registration_status: str) -> str:
    return ELIGIBILITY[registration_status]


def eligibility_sql():
    """SQL version for queries that outer-join RiskAssessment and Review."""
    status = registration_status_sql()
    return case(
        (status.in_([CLEAR, VERIFIED]), ELIGIBLE),
        (status == REJECTED, NOT_ELIGIBLE),
        else_=PENDING,
    )


@dataclass
class Counts:
    eligible: int = 0
    pending: int = 0
    not_eligible: int = 0

    def add(self, kind: str, number: int) -> None:
        setattr(self, kind, getattr(self, kind) + number)

    def merge(self, other: Counts) -> None:
        for kind, number in vars(other).items():
            self.add(kind, number)


@dataclass
class AgentCounts:
    totals: Counts = field(default_factory=Counts)
    by_month: dict[date, Counts] = field(default_factory=dict)


def eligibility_counts(
    session: Session, client_id: UUID | None = None
) -> dict[UUID, AgentCounts]:
    """Counts per agent, in total and per registration month (UTC).

    With client_id, only customers registered for that client are counted
    (customers.client_id, the client named in their consent).
    """
    month = utc_month(Customer.created_at)
    kind = eligibility_sql()
    query = (
        select(Customer.agent_id, month, kind, func.count(Customer.id))
        .outerjoin(RiskAssessment, RiskAssessment.customer_id == Customer.id)
        .outerjoin(Review, Review.assessment_id == RiskAssessment.id)
        .group_by(Customer.agent_id, month, kind)
    )
    if client_id is not None:
        query = query.where(Customer.client_id == client_id)
    results: dict[UUID, AgentCounts] = {}
    for agent_id, start, name, number in session.execute(query):
        agent = results.setdefault(agent_id, AgentCounts())
        agent.totals.add(name, number)
        agent.by_month.setdefault(start.date(), Counts()).add(name, number)
    return results
