"""What an agent may see about their own performance (SRS 2.2.1, 3.8, 4.1.1).

Agents never see their reputation score, risk band, probabilities, reasons,
or any customer's status: those would show them which registrations the model
flags and how to avoid it. They see instead:

- one standing label, from the internal band:
      Insufficient data      -> "New agent"
      Low risk or Watch      -> "Good standing"
      High risk              -> "Account under review"
- monthly totals: registrations, eligible, and awaiting verification.

Both are calculated as of the start of the current month (the end of the
previous month) and cover completed months only, so they change once a month
and one registration cannot be traced to a change. A month with fewer than
MIN_REGISTRATIONS_FOR_BREAKDOWN registrations shows its total only, because
with a handful of customers the split would reveal individual outcomes.
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from app.models import ScoringConfig
from app.services.eligibility import ELIGIBLE, PENDING, eligibility
from app.services.kpis import Registration, next_month, reputation_at
from app.services.periods import recent_months
from app.services.reputation import INSUFFICIENT_DATA, risk_band

NEW_AGENT = "New agent"
GOOD_STANDING = "Good standing"
ACCOUNT_UNDER_REVIEW = "Account under review"
STANDING_BY_BAND = {
    INSUFFICIENT_DATA: NEW_AGENT,
    "Low risk": GOOD_STANDING,
    "Watch": GOOD_STANDING,
    "High risk": ACCOUNT_UNDER_REVIEW,
}
MIN_REGISTRATIONS_FOR_BREAKDOWN = 10
ACTIVITY_MONTHS = 12


@dataclass(frozen=True)
class MonthActivity:
    month: date
    registrations: int
    # None when the month has fewer than MIN_REGISTRATIONS_FOR_BREAKDOWN.
    eligible: int | None
    awaiting_verification: int | None


def cutoff(now: datetime) -> datetime:
    """The start of the current month (UTC): the moment both views use."""
    return datetime(now.year, now.month, 1, tzinfo=UTC)


def agent_standing(
    registrations: list[Registration], now: datetime, config: ScoringConfig
) -> str:
    n_users, reputation = reputation_at(registrations, cutoff(now), config)
    band = (
        INSUFFICIENT_DATA
        if reputation is None
        else risk_band(n_users, reputation, config)
    )
    return STANDING_BY_BAND[band]


def agent_activity(
    registrations: list[Registration], now: datetime
) -> list[MonthActivity]:
    """The last 12 completed months, oldest first, as known at the cutoff."""
    moment = cutoff(now)
    months = recent_months((moment - timedelta(days=1)).date(), ACTIVITY_MONTHS)
    results = []
    for month in months:
        start = datetime.combine(month, datetime.min.time(), UTC)
        end = datetime.combine(next_month(month), datetime.min.time(), UTC)
        cohort = [r for r in registrations if start <= r.registered_at < end]
        kinds = [eligibility(r.status_at(moment)) for r in cohort]
        shown = len(cohort) >= MIN_REGISTRATIONS_FOR_BREAKDOWN
        results.append(
            MonthActivity(
                month=month,
                registrations=len(cohort),
                eligible=kinds.count(ELIGIBLE) if shown else None,
                awaiting_verification=kinds.count(PENDING) if shown else None,
            )
        )
    return results
