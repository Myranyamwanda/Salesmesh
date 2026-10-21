"""Admin review of a risk assessment: the final, human decision."""

from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Customer, Review, RiskAssessment, User
from app.services.audit import audit

STATUS_AFTER_REVIEW = {"confirmed_real": "verified", "confirmed_fake": "rejected"}
ALREADY_REVIEWED = "This assessment has already been reviewed"


class AlreadyReviewedError(Exception):
    """Raised when an assessment already has its one review."""


def apply_review(
    session: Session,
    request: Request | None,
    reviewer: User,
    assessment: RiskAssessment,
    decision: str,
    notes: str | None,
) -> Review:
    """Record the review, update the customer, and audit it. The caller commits.

    Shared by the API and the demo seed, so both update statuses, audit
    entries, and reputations the same way. A confirmed_real review removes the
    flag from the agent's reputation; confirmed_fake keeps it.
    """
    existing = session.scalar(
        select(Review.id).where(Review.assessment_id == assessment.id)
    )
    if existing is not None:
        raise AlreadyReviewedError
    customer = session.get(Customer, assessment.customer_id)
    review = Review(
        assessment_id=assessment.id,
        reviewer_id=reviewer.id,
        decision=decision,
        notes=notes,
    )
    session.add(review)
    customer.status = STATUS_AFTER_REVIEW[decision]
    session.flush()
    audit(
        session,
        request,
        "assessment_reviewed",
        actor=reviewer,
        target=session.get(User, customer.agent_id),
        subject=f"assessment:{assessment.id}",
    )
    return review


def review_assessment(
    session: Session,
    request: Request,
    reviewer: User,
    assessment_id,
    decision: str,
    notes: str | None,
) -> Review:
    """API entry point: lock the assessment, review it, and commit.

    Failed attempts are audited too.
    """
    subject = f"assessment:{assessment_id}"
    assessment = session.scalar(
        select(RiskAssessment)
        .where(RiskAssessment.id == assessment_id)
        .with_for_update()
    )
    if assessment is None:
        audit(
            session,
            request,
            "assessment_reviewed",
            "failure",
            reviewer,
            subject=subject,
        )
        session.commit()
        raise HTTPException(404, "Assessment not found")
    try:
        review = apply_review(session, request, reviewer, assessment, decision, notes)
    except AlreadyReviewedError:
        customer = session.get(Customer, assessment.customer_id)
        audit(
            session,
            request,
            "assessment_reviewed",
            "failure",
            reviewer,
            session.get(User, customer.agent_id),
            subject=subject,
        )
        session.commit()
        raise HTTPException(409, ALREADY_REVIEWED) from None
    except IntegrityError:
        # Another admin reviewed it at the same moment.
        session.rollback()
        raise HTTPException(409, ALREADY_REVIEWED) from None
    session.commit()
    return review
