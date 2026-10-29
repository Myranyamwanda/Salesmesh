"""Client endpoints: the quality of registrations made by the client's agents.

Clients see only outcomes a person has confirmed. Model flags are not shown:
at the model's precision about 9 in 10 flagged registrations are genuine, so a
"flagged %" would overstate fraud and could unfairly harm an agent's standing.
Registrations still waiting for a decision are shown as a plain count.
"""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select

from app.auth import Database, require_roles
from app.models import AgentProfile, Customer, Review, RiskAssessment, User
from app.services.eligibility import AgentCounts, Counts, eligibility_counts
from app.services.periods import recent_months, utc_month

router = APIRouter(prefix="/client", tags=["Client"])
type Client = Annotated[User, Depends(require_roles("client"))]
TREND_MONTHS = 12


class MonthQuality(BaseModel):
    month: str
    registrations: int
    confirmed_fake: int
    # None for a month without registrations, never a misleading 0 %.
    confirmed_fake_percent: float | None


class QualityRead(BaseModel):
    registrations: int
    confirmed_fake: int
    confirmed_fake_percent: float
    under_review: int
    trend: list[MonthQuality]


class AgentEligibility(BaseModel):
    display_name: str
    eligible: int
    not_eligible: int


class ClientEligibility(BaseModel):
    eligible: int
    # A total only: per agent or per month it would show clients which
    # registrations the model flagged (about 9 in 10 flags are genuine).
    pending: int
    not_eligible: int
    agents: list[AgentEligibility]


def percent(part: int, whole: int) -> float:
    return round(100 * part / whole, 1) if whole else 0.0


@router.get("/quality", response_model=QualityRead)
def quality(session: Database, client: Client) -> QualityRead:
    """Totals and a monthly trend of registrations made for this client.

    Counted by the client recorded at registration (customers.client_id), so
    an agent's registrations for an earlier client are not included. Months
    are calendar months in UTC.
    """
    month = utc_month(Customer.created_at)
    rows = session.execute(
        select(
            month,
            func.count(Customer.id),
            func.count(Customer.id).filter(Review.decision == "confirmed_fake"),
            func.count(Customer.id).filter(Customer.status == "pending_review"),
        )
        .outerjoin(RiskAssessment, RiskAssessment.customer_id == Customer.id)
        .outerjoin(Review, Review.assessment_id == RiskAssessment.id)
        .where(Customer.client_id == client.id)
        .group_by(month)
    ).all()
    by_month = {start.date(): values for start, *values in rows}
    totals = [sum(values[i] for values in by_month.values()) for i in range(3)]
    registrations, fake, under_review = totals
    trend = []
    for start in recent_months(datetime.now(UTC).date(), TREND_MONTHS):
        month_registrations, month_fake, _ = by_month.get(start, (0, 0, 0))
        trend.append(
            MonthQuality(
                month=start.strftime("%Y-%m"),
                registrations=month_registrations,
                confirmed_fake=month_fake,
                confirmed_fake_percent=percent(month_fake, month_registrations)
                if month_registrations
                else None,
            )
        )
    return QualityRead(
        registrations=registrations,
        confirmed_fake=fake,
        confirmed_fake_percent=percent(fake, registrations),
        under_review=under_review,
        trend=trend,
    )


@router.get("/eligibility", response_model=ClientEligibility)
def eligibility(session: Database, client: Client) -> ClientEligibility:
    """Commission eligibility of the registrations made for this client.

    Counted by the client recorded at registration (customers.client_id), so
    an agent's earlier registrations for another client are never included.
    Agents currently assigned to the client are listed even with no
    registrations yet.
    """
    counts = eligibility_counts(session, client_id=client.id)
    profiles = session.scalars(
        select(AgentProfile)
        .where(
            (AgentProfile.client_id == client.id)
            | AgentProfile.user_id.in_(list(counts))
        )
        .order_by(AgentProfile.display_name, AgentProfile.user_id)
    ).all()
    totals = Counts()
    agents = []
    for profile in profiles:
        agent_totals = counts.get(profile.user_id, AgentCounts()).totals
        totals.merge(agent_totals)
        agents.append(
            AgentEligibility(
                display_name=profile.display_name,
                eligible=agent_totals.eligible,
                not_eligible=agent_totals.not_eligible,
            )
        )
    return ClientEligibility(
        eligible=totals.eligible,
        pending=totals.pending,
        not_eligible=totals.not_eligible,
        agents=agents,
    )
