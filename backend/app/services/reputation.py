"""Agent reputation: a smoothed rate of flagged customers, from 0 to 100.

reputation = 100 * (1 - (flags + k * p0) / (n_users + k))

p0 is the platform's expected flag rate and k acts as k "imaginary" customers
flagged at that rate. A new agent therefore starts near 100 * (1 - p0), and a
few flags cannot swing a small agent's score to an extreme. This is the same
formula as ml/notebooks/06_agent_simulation.ipynb.

Reputation is an admin-only decision-support tool; agents never see it.
"""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import AgentProfile, Customer, ScoringConfig

# A flagged customer waiting for review, or one an admin confirmed as fake.
# A confirmed_real review sets the status to verified, which removes the flag.
FLAG_STATUSES = ("pending_review", "rejected")
INSUFFICIENT_DATA = "Insufficient data"


def reputation_score(n_users: int, flags: int, k: float, p0: float) -> float:
    return round(100 * (1 - (flags + k * p0) / (n_users + k)), 1)


def risk_band(n_users: int, reputation: float, config: ScoringConfig) -> str:
    if n_users < config.min_users_for_band:
        return INSUFFICIENT_DATA
    if reputation < config.high_risk_below:
        return "High risk"
    if reputation < config.watch_below:
        return "Watch"
    return "Low risk"


@dataclass(frozen=True)
class AgentReputation:
    agent_id: UUID
    n_users: int
    flags: int
    confirmed_fake: int
    pending_review: int
    assisted: int
    reputation: float
    risk_score: float
    band: str

    @property
    def assisted_share(self) -> float:
        """Share of customers the agent registered on their own device."""
        return round(self.assisted / self.n_users, 3) if self.n_users else 0.0


def agent_reputations(
    session: Session, config: ScoringConfig, agent_ids: list[UUID] | None = None
) -> dict[UUID, AgentReputation]:
    """Count each agent's customers in one query and score every agent.

    Agents without customers are included with n_users = 0.
    """
    by_status = Customer.status.in_(FLAG_STATUSES)
    query = (
        select(
            AgentProfile.user_id,
            func.count(Customer.id),
            func.count(Customer.id).filter(by_status),
            func.count(Customer.id).filter(Customer.status == "rejected"),
            func.count(Customer.id).filter(Customer.status == "pending_review"),
            func.count(Customer.id).filter(Customer.assisted),
        )
        .outerjoin(Customer, Customer.agent_id == AgentProfile.user_id)
        .group_by(AgentProfile.user_id)
    )
    if agent_ids is not None:
        query = query.where(AgentProfile.user_id.in_(agent_ids))
    results = {}
    for agent_id, n_users, flags, fake, pending, assisted in session.execute(query):
        reputation = reputation_score(n_users, flags, config.k, config.p0)
        results[agent_id] = AgentReputation(
            agent_id=agent_id,
            n_users=n_users,
            flags=flags,
            confirmed_fake=fake,
            pending_review=pending,
            assisted=assisted,
            reputation=reputation,
            risk_score=round(100 - reputation, 1),
            band=risk_band(n_users, reputation, config),
        )
    return results
