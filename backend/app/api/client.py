"""Client endpoints: the quality of registrations made by the client's agents.

Clients see only outcomes a person has confirmed. Model flags are not shown:
at the model's precision about 9 in 10 flagged registrations are genuine, so a
"flagged %" would overstate fraud and could unfairly harm an agent's standing.
Registrations still waiting for a decision are shown as a plain count.
"""

from datetime import UTC, date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select

from app.auth import Database, require_roles
from app.models import AgentProfile, Customer, Review, RiskAssessment, User

router = APIRouter(prefix="/client", tags=["Client"])
type Client = Annotated[User, Depends(require_roles("client"))]
TREND_MONTHS = 12


class MonthQuality(BaseModel):
    month: str
    registrations: int
    confirmed_fake: int


class QualityRead(BaseModel):
    registrations: int
    confirmed_fake: int
    confirmed_fake_percent: float
    under_review: int
    trend: list[MonthQuality]


def percent(part: int, whole: int) -> float:
    return round(100 * part / whole, 1) if whole else 0.0


def recent_months(today: date, count: int) -> list[date]:
    """The first day of the last `count` months, oldest first."""
    months = []
    year, month = today.year, today.month
    for _ in range(count):
        months.append(date(year, month, 1))
        year, month = (year, month - 1) if month > 1 else (year - 1, 12)
    return months[::-1]


@router.get("/quality", response_model=QualityRead)
def quality(session: Database, client: Client) -> QualityRead:
    """Totals and a monthly trend, only for agents assigned to this client.

    Months are calendar months in UTC.
    """
    month = func.date_trunc("month", func.timezone("UTC", Customer.created_at))
    rows = session.execute(
        select(
            month,
            func.count(Customer.id),
            func.count(Customer.id).filter(Review.decision == "confirmed_fake"),
            func.count(Customer.id).filter(Customer.status == "pending_review"),
        )
        .join(AgentProfile, AgentProfile.user_id == Customer.agent_id)
        .outerjoin(RiskAssessment, RiskAssessment.customer_id == Customer.id)
        .outerjoin(Review, Review.assessment_id == RiskAssessment.id)
        .where(AgentProfile.client_id == client.id)
        .group_by(month)
    ).all()
    by_month = {start.date(): values for start, *values in rows}
    totals = [sum(values[i] for values in by_month.values()) for i in range(3)]
    registrations, fake, under_review = totals
    trend = [
        MonthQuality(
            month=start.strftime("%Y-%m"),
            registrations=by_month.get(start, (0, 0, 0))[0],
            confirmed_fake=by_month.get(start, (0, 0, 0))[1],
        )
        for start in recent_months(datetime.now(UTC).date(), TREND_MONTHS)
    ]
    return QualityRead(
        registrations=registrations,
        confirmed_fake=fake,
        confirmed_fake_percent=percent(fake, registrations),
        under_review=under_review,
        trend=trend,
    )
