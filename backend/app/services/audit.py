from fastapi import Request
from sqlalchemy.orm import Session

from app.models import AuditLog, User


def audit(
    session: Session,
    request: Request,
    action: str,
    outcome: str = "success",
    actor: User | None = None,
    target: User | None = None,
    client_ip_hash: str | None = None,
) -> None:
    session.add(
        AuditLog(
            actor_user_id=actor.id if actor else None,
            target_user_id=target.id if target else None,
            action=action,
            outcome=outcome,
            request_id=request.state.request_id,
            client_ip_hash=client_ip_hash,
        )
    )
