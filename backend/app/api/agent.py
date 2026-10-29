"""Agent endpoints.

Agents see their referral link, the customers they onboarded (name, date,
assisted), one standing label, and monthly totals of completed months.
Reputation, bands, probabilities, reasons, and customer statuses are admin-only:
a customer's status would reveal whether the model flagged them. See
app/services/standing.py for the rules.
"""

from datetime import UTC, date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select

from app.auth import Configuration, Database, require_roles
from app.models import AgentProfile, Customer, ScoringConfig, User
from app.services.kpis import load_registrations
from app.services.standing import agent_activity, agent_standing, cutoff

router = APIRouter(prefix="/me", tags=["Agent"])
type Agent = Annotated[User, Depends(require_roles("agent"))]


class ReferralRead(BaseModel):
    referral_code: str
    display_name: str
    link: str


class MyCustomer(BaseModel):
    full_name: str
    registered_at: datetime
    assisted: bool


class MyCustomerPage(BaseModel):
    items: list[MyCustomer]
    total: int


@router.get("/referral", response_model=ReferralRead)
def my_referral(
    session: Database, settings: Configuration, agent: Agent
) -> ReferralRead:
    profile = session.get(AgentProfile, agent.id)
    if profile is None:
        raise HTTPException(404, "No referral link for this account")
    return ReferralRead(
        referral_code=profile.referral_code,
        display_name=profile.display_name,
        link=f"{settings.frontend_url}/join/{profile.referral_code}",
    )


@router.get("/customers", response_model=MyCustomerPage)
def my_customers(
    session: Database,
    agent: Agent,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
) -> MyCustomerPage:
    """Name, registration date, and assisted only, newest first."""
    rows = session.execute(
        select(Customer.full_name, Customer.created_at, Customer.assisted)
        .where(Customer.agent_id == agent.id)
        .order_by(Customer.created_at.desc(), Customer.id)
        .offset(offset)
        .limit(limit)
    )
    total = session.scalar(
        select(func.count()).select_from(Customer).where(Customer.agent_id == agent.id)
    )
    return MyCustomerPage(
        items=[
            MyCustomer(full_name=name, registered_at=created, assisted=assisted)
            for name, created, assisted in rows
        ],
        total=total,
    )


class StandingRead(BaseModel):
    standing: Literal["New agent", "Good standing", "Account under review"]
    # The standing is recalculated once a month, from this date.
    as_of: date


class MonthActivityRead(BaseModel):
    month: str
    registrations: int
    # null for a month with fewer than 10 registrations (totals only).
    eligible: int | None
    awaiting_verification: int | None


class ActivityRead(BaseModel):
    as_of: date
    months: list[MonthActivityRead]


@router.get("/standing", response_model=StandingRead)
def my_standing(session: Database, agent: Agent) -> StandingRead:
    """One label only: never the score, band, probabilities, or reasons."""
    now = datetime.now(UTC)
    standing = agent_standing(
        load_registrations(session, [agent.id]), now, session.get(ScoringConfig, 1)
    )
    return StandingRead(standing=standing, as_of=cutoff(now).date())


@router.get("/activity", response_model=ActivityRead)
def my_activity(session: Database, agent: Agent) -> ActivityRead:
    """Monthly totals for the last 12 completed months, oldest first."""
    now = datetime.now(UTC)
    months = agent_activity(load_registrations(session, [agent.id]), now)
    return ActivityRead(
        as_of=cutoff(now).date(),
        months=[
            MonthActivityRead(
                month=row.month.strftime("%Y-%m"),
                registrations=row.registrations,
                eligible=row.eligible,
                awaiting_verification=row.awaiting_verification,
            )
            for row in months
        ],
    )
