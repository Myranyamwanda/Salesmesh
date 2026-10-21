"""Erase a customer's personal data on request (Kenya Data Protection Act 2019).

Deleting the customer row also deletes its risk assessments and reviews
(ON DELETE CASCADE). The audit entry records only who erased which customer ID,
never the erased personal data. The agent's reputation changes at once, because
it is calculated on read.
"""

from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Customer, User
from app.services.audit import audit


def erase_customer(
    session: Session, request: Request, admin: User, customer_id, confirm_email: str
) -> None:
    subject = f"customer:{customer_id}"
    customer = session.scalar(
        select(Customer).where(Customer.id == customer_id).with_for_update()
    )
    if customer is None:
        audit(session, request, "customer_erased", "failure", admin, subject=subject)
        session.commit()
        raise HTTPException(404, "Customer not found")
    agent = session.get(User, customer.agent_id)
    # The server checks the typed confirmation too, not only the browser.
    if confirm_email.strip().lower() != customer.email:
        audit(
            session,
            request,
            "customer_erased",
            "failure",
            admin,
            agent,
            subject=subject,
        )
        session.commit()
        raise HTTPException(422, "The confirmation email does not match")
    session.delete(customer)
    audit(
        session, request, "customer_erased", actor=admin, target=agent, subject=subject
    )
    session.commit()
