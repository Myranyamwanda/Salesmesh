"""Admin review of a risk assessment: the final, human decision."""

from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Customer, Review, RiskAssessment, User
from app.services.audit import audit

STATUS_AFTER_REVIEW = {"confirmed_real": "verified", "confirmed_fake": "rejected"}


def review_assessment(
    session: Session,
    request: Request,
    reviewer: User,
    assessment_id,
    decision: str,
    notes: str | None,
) -> Review:
    """Record the one review of an assessment and update the customer.

    A confirmed_real review removes the flag from the agent's reputation;
    confirmed_fake keeps it. Every attempt is audited.
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
    customer = session.get(Customer, assessment.customer_id)
    agent = session.get(User, customer.agent_id)
    already = session.scalar(
        select(Review.id).where(Review.assessment_id == assessment.id)
    )
    if already is not None:
        audit(
            session,
            request,
            "assessment_reviewed",
            "failure",
            reviewer,
            agent,
            subject=subject,
        )
        session.commit()
        raise HTTPException(409, "This assessment has already been reviewed")

    review = Review(
        assessment_id=assessment.id,
        reviewer_id=reviewer.id,
        decision=decision,
        notes=notes,
    )
    session.add(review)
    customer.status = STATUS_AFTER_REVIEW[decision]
    try:
        session.flush()
    except IntegrityError:
        # Another admin reviewed it at the same moment.
        session.rollback()
        raise HTTPException(409, "This assessment has already been reviewed") from None
    audit(
        session,
        request,
        "assessment_reviewed",
        actor=reviewer,
        target=agent,
        subject=subject,
    )
    session.commit()
    return review
