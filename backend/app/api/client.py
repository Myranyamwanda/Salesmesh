"""Client endpoints: the quality of registrations made by the client's agents."""

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
    flagged: int
    confirmed_fake: int


class QualityRead(BaseModel):
    registrations: int
    flagged: int
    flagged_percent: float
    confirmed_fake: int
    confirmed_fake_percent: float
    pending_review: int
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
            func.count(Customer.id).filter(RiskAssessment.flagged),
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
    totals = [sum(values[i] for values in by_month.values()) for i in range(4)]
    registrations, flagged, fake, pending = totals
    trend = [
        MonthQuality(
            month=start.strftime("%Y-%m"),
            registrations=by_month.get(start, (0, 0, 0, 0))[0],
            flagged=by_month.get(start, (0, 0, 0, 0))[1],
            confirmed_fake=by_month.get(start, (0, 0, 0, 0))[2],
        )
        for start in recent_months(datetime.now(UTC).date(), TREND_MONTHS)
    ]
    return QualityRead(
        registrations=registrations,
        flagged=flagged,
        flagged_percent=percent(flagged, registrations),
        confirmed_fake=fake,
        confirmed_fake_percent=percent(fake, registrations),
        pending_review=pending,
        trend=trend,
    )
