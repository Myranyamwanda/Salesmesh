"""Monthly KPIs and reputation as of a past date (SRS 3.8, 8.3).

Each month counts the registrations made in it (a cohort, by registration
time in UTC) and describes what has happened to them so far:

    flag_rate            flagged / registrations          (admin only)
    confirmed_fake_rate  confirmed fake / registrations
    verification_rate    confirmed real / reviewed
    avg_hours_to_review  mean of review time - score time
    eligible             clear or verified (commission eligibility)

A rate is None when its denominator is 0, so an empty month is never shown
as 0 %. Reputation at the end of a month uses only what was known then: a
registration counts as a flag at time T if, before T, an admin confirmed it
as fake, or it was flagged and not yet confirmed real. At the current time
this is exactly the live rule in reputation.py (status pending_review or
rejected). The current p0 and k are used for every month, because settings
changes are not versioned.

The figures are computed in Python from one row per registration. That keeps
every definition in one readable place and testable without a database; at
much larger volumes the same rules would move into SQL.
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime, time
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Customer, Review, RiskAssessment, ScoringConfig
from app.services.eligibility import ELIGIBLE, eligibility
from app.services.pipeline import registration_status
from app.services.reputation import reputation_score

UTC_MIDNIGHT = time(0, 0)


@dataclass(frozen=True)
class Registration:
    """What KPIs need about one customer; no personal data."""

    agent_id: UUID
    registered_at: datetime
    scored_at: datetime | None
    flagged: bool | None
    reviewed_at: datetime | None
    decision: str | None

    def is_flag_at(self, moment: datetime) -> bool:
        reviewed = self.reviewed_at is not None and self.reviewed_at < moment
        if reviewed and self.decision == "confirmed_fake":
            return True
        scored = self.scored_at is not None and self.scored_at < moment
        confirmed_real = reviewed and self.decision == "confirmed_real"
        return bool(scored and self.flagged and not confirmed_real)


@dataclass(frozen=True)
class MonthKpis:
    month: date
    registrations: int
    flagged: int
    confirmed_fake: int
    reviewed: int
    confirmed_real: int
    eligible: int
    flag_rate: float | None
    confirmed_fake_rate: float | None
    verification_rate: float | None
    avg_hours_to_review: float | None
    # Customers registered before the end of the month, and the reputation
    # then; None while the agent had no registrations.
    n_users_to_date: int
    reputation: float | None


def rate(part: int, whole: int) -> float | None:
    return round(part / whole, 4) if whole else None


def next_month(month: date) -> date:
    return date(month.year + month.month // 12, month.month % 12 + 1, 1)


def load_registrations(
    session: Session,
    agent_ids: list[UUID] | None = None,
    client_id: UUID | None = None,
) -> list[Registration]:
    query = (
        select(
            Customer.agent_id,
            Customer.created_at,
            RiskAssessment.created_at,
            RiskAssessment.flagged,
            Review.created_at,
            Review.decision,
        )
        .outerjoin(RiskAssessment, RiskAssessment.customer_id == Customer.id)
        .outerjoin(Review, Review.assessment_id == RiskAssessment.id)
    )
    if agent_ids is not None:
        query = query.where(Customer.agent_id.in_(agent_ids))
    if client_id is not None:
        query = query.where(Customer.client_id == client_id)
    return [Registration(*row) for row in session.execute(query)]


def reputation_at(
    registrations: list[Registration], moment: datetime, config: ScoringConfig
) -> tuple[int, float | None]:
    """(customers registered before `moment`, reputation then or None)."""
    known = [r for r in registrations if r.registered_at < moment]
    if not known:
        return 0, None
    flags = sum(r.is_flag_at(moment) for r in known)
    return len(known), reputation_score(len(known), flags, config.k, config.p0)


def monthly_kpis(
    registrations: list[Registration],
    months: list[date],
    now: datetime,
    config: ScoringConfig,
) -> list[MonthKpis]:
    """KPIs for each month (first days, oldest first). The current month's
    reputation is as of `now`, because its end is still in the future."""
    results = []
    for month in months:
        start = datetime.combine(month, UTC_MIDNIGHT, UTC)
        end = datetime.combine(next_month(month), UTC_MIDNIGHT, UTC)
        cohort = [r for r in registrations if start <= r.registered_at < end]
        reviewed = [r for r in cohort if r.reviewed_at is not None]
        hours = [
            (r.reviewed_at - r.scored_at).total_seconds() / 3600
            for r in reviewed
            if r.scored_at is not None
        ]
        eligible = sum(
            eligibility(registration_status(r.flagged, r.decision)) == ELIGIBLE
            for r in cohort
        )
        flagged = sum(bool(r.flagged) for r in cohort)
        fake = sum(r.decision == "confirmed_fake" for r in cohort)
        real = sum(r.decision == "confirmed_real" for r in cohort)
        n_users, reputation = reputation_at(registrations, min(end, now), config)
        results.append(
            MonthKpis(
                month=month,
                registrations=len(cohort),
                flagged=flagged,
                confirmed_fake=fake,
                reviewed=len(reviewed),
                confirmed_real=real,
                eligible=eligible,
                flag_rate=rate(flagged, len(cohort)),
                confirmed_fake_rate=rate(fake, len(cohort)),
                verification_rate=rate(real, len(reviewed)),
                avg_hours_to_review=round(sum(hours) / len(hours), 1)
                if hours
                else None,
                n_users_to_date=n_users,
                reputation=reputation,
            )
        )
    return results
