"""Agent endpoints.

Agents can see only their referral link and the list of customers they
onboarded. Reputation is an admin-only decision-support tool, and a customer's
status would reveal whether the model flagged them, so neither is returned.
"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select

from app.auth import Configuration, Database, require_roles
from app.models import AgentProfile, Customer, User

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
