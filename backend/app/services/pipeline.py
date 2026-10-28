"""The registration pipeline status, derived from the score and the review.

    received -> clear          (not flagged by the model or the rule)
    received -> under_review   (flagged) -> verified | rejected (admin review)

The status is derived instead of stored, so it can never disagree with the
assessment and review it comes from, and customers.status (which reputation
reads) is unchanged. "received" lasts only until the registration is scored,
which happens in the same transaction, so in practice it is never seen.
"""

from typing import Literal

from sqlalchemy import case

from app.models import Review, RiskAssessment

type RegistrationStatus = Literal[
    "received", "clear", "under_review", "verified", "rejected"
]

RECEIVED = "received"
CLEAR = "clear"
UNDER_REVIEW = "under_review"
VERIFIED = "verified"
REJECTED = "rejected"


def registration_status(flagged: bool | None, decision: str | None) -> str:
    """Python version, for rows already loaded: flagged is None without a score."""
    if flagged is None:
        return RECEIVED
    if not flagged:
        return CLEAR
    if decision == "confirmed_real":
        return VERIFIED
    if decision == "confirmed_fake":
        return REJECTED
    return UNDER_REVIEW


def registration_status_sql():
    """SQL version for queries that outer-join RiskAssessment and Review."""
    return case(
        (RiskAssessment.id.is_(None), RECEIVED),
        (RiskAssessment.flagged.is_(False), CLEAR),
        (Review.decision == "confirmed_real", VERIFIED),
        (Review.decision == "confirmed_fake", REJECTED),
        else_=UNDER_REVIEW,
    )
