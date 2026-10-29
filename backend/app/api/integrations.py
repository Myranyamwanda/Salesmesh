"""Versioned API for other SalesMesh modules (SRS 3.8, 4.2.1, 4.2.2).

GET /api/v1/agents/{id}/reputation lets, for example, a task-assignment module
use reputation in its decisions. It is a stable contract: fields are only ever
added. Access is admin-only for now; a service account with its own
credentials for module-to-module calls is a documented future integration
point, because adding one would change authentication. Every request is
audited, and the audit entries also provide the rate limit, so it works the
same with several API workers and needs no extra table.
"""

from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func, select, text

from app.auth import Configuration, Database, require_roles
from app.models import AgentProfile, AuditLog, ScoringConfig, User
from app.services.audit import audit
from app.services.reputation import agent_reputations

router = APIRouter(prefix="/api/v1", tags=["Integration API (v1)"])
type Admin = Annotated[User, Depends(require_roles("admin"))]
ACTION = "reputation_api_read"
# Separates these advisory locks from the login and join rate-limit locks.
LOCK_NAMESPACE = 3


class ReputationRead(BaseModel):
    agent_id: UUID
    score: float
    # The internal band: High risk, Watch, Low risk, or Insufficient data.
    band: str
    n: int
    flags: int
    # Reputation is calculated on read, so this is the time of the request.
    computed_at: datetime


def check_rate(session, request: Request, actor: User, settings, subject: str):
    """Allow reputation_api_rate_limit requests per admin within the window.

    The advisory lock makes concurrent requests from one admin count one at a
    time, so a burst cannot pass the limit together.
    """
    session.execute(
        text("SELECT pg_advisory_xact_lock(:namespace, :key)"),
        {"namespace": LOCK_NAMESPACE, "key": int(actor.id.hex[:7], 16)},
    )
    window = settings.reputation_api_rate_window_seconds
    since = datetime.now(UTC) - timedelta(seconds=window)
    recent = session.scalar(
        select(func.count())
        .select_from(AuditLog)
        .where(
            AuditLog.actor_user_id == actor.id,
            AuditLog.action == ACTION,
            AuditLog.created_at >= since,
        )
    )
    if recent >= settings.reputation_api_rate_limit:
        audit(session, request, ACTION, "rate_limited", actor, subject=subject)
        session.commit()
        raise HTTPException(
            429,
            "Too many reputation requests. Try again later.",
            headers={"Retry-After": str(window)},
        )


@router.get("/agents/{agent_id}/reputation", response_model=ReputationRead)
def agent_reputation(
    agent_id: UUID,
    request: Request,
    session: Database,
    settings: Configuration,
    actor: Admin,
) -> ReputationRead:
    """One agent's reputation score, internal band, and the counts behind it."""
    subject = f"agent:{agent_id}"
    check_rate(session, request, actor, settings, subject)
    if session.get(AgentProfile, agent_id) is None:
        audit(session, request, ACTION, "failure", actor, subject=subject)
        session.commit()
        raise HTTPException(404, "Agent not found")
    stats = agent_reputations(session, session.get(ScoringConfig, 1), [agent_id])
    result = stats[agent_id]
    agent = session.get(User, agent_id)
    audit(session, request, ACTION, actor=actor, target=agent, subject=subject)
    session.commit()
    return ReputationRead(
        agent_id=agent_id,
        score=result.reputation,
        band=result.band,
        n=result.n_users,
        flags=result.flags,
        computed_at=datetime.now(UTC),
    )
