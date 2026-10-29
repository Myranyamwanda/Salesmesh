"""Admin KPI endpoints: per agent, for the network, and a flag-rate benchmark."""

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from app.auth import Database, require_roles
from app.models import AgentProfile, ScoringConfig, User
from app.schemas.scoring import AgentSummary
from app.services.kpis import MonthKpis, load_registrations, monthly_kpis, rate
from app.services.periods import recent_months

router = APIRouter(prefix="/admin", tags=["KPIs"])
type Admin = Annotated[User, Depends(require_roles("admin"))]
KPI_MONTHS = 12


class MonthKpiRead(BaseModel):
    """One registration month (UTC). Rates are None when nothing to divide."""

    month: str
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


class AgentMonthKpiRead(MonthKpiRead):
    # Reputation at the end of the month (now, for the current month).
    n_users_to_date: int
    reputation: float | None


class AgentKpis(BaseModel):
    agent: AgentSummary
    months: list[AgentMonthKpiRead]


class BenchmarkRow(BaseModel):
    """An agent's flag rate over the 12 months against the network's."""

    agent: AgentSummary
    registrations: int
    flag_rate: float | None
    difference: float | None
    # Below min_users_for_band registrations the rate is too noisy to compare.
    enough_data: bool


class NetworkKpis(BaseModel):
    months: list[MonthKpiRead]
    network_flag_rate: float | None
    min_registrations: int
    benchmark: list[BenchmarkRow]


def read_month(kpis: MonthKpis) -> dict:
    # Pydantic ignores the reputation fields for the network rows.
    return vars(kpis) | {"month": kpis.month.strftime("%Y-%m")}


def window():
    now = datetime.now(UTC)
    return now, recent_months(now.date(), KPI_MONTHS)


@router.get("/agents/{agent_id}/kpis", response_model=AgentKpis)
def agent_kpis(agent_id: UUID, session: Database, _: Admin) -> AgentKpis:
    """The agent's monthly KPIs and reputation trend for the last 12 months."""
    profile = session.get(AgentProfile, agent_id)
    if profile is None:
        raise HTTPException(404, "Agent not found")
    now, months = window()
    config = session.get(ScoringConfig, 1)
    rows = monthly_kpis(load_registrations(session, [agent_id]), months, now, config)
    return AgentKpis(
        agent=AgentSummary(id=profile.user_id, display_name=profile.display_name),
        months=[AgentMonthKpiRead(**read_month(row)) for row in rows],
    )


@router.get("/kpis", response_model=NetworkKpis)
def network_kpis(session: Database, _: Admin) -> NetworkKpis:
    """Network KPIs per month and each agent's flag rate against the network.

    The benchmark covers the same 12 months; agents are ordered by how far
    above the network rate they are, agents with too little data last.
    """
    now, months = window()
    config = session.get(ScoringConfig, 1)
    registrations = load_registrations(session)
    network = monthly_kpis(registrations, months, now, config)
    network_registrations = sum(row.registrations for row in network)
    network_rate = rate(sum(row.flagged for row in network), network_registrations)

    start = datetime.combine(months[0], datetime.min.time(), UTC)
    recent = [r for r in registrations if r.registered_at >= start]
    benchmark = []
    for profile in session.scalars(select(AgentProfile)):
        mine = [r for r in recent if r.agent_id == profile.user_id]
        agent_rate = rate(sum(bool(r.flagged) for r in mine), len(mine))
        difference = (
            round(agent_rate - network_rate, 4)
            if agent_rate is not None and network_rate is not None
            else None
        )
        benchmark.append(
            BenchmarkRow(
                agent=AgentSummary(
                    id=profile.user_id, display_name=profile.display_name
                ),
                registrations=len(mine),
                flag_rate=agent_rate,
                difference=difference,
                enough_data=len(mine) >= config.min_users_for_band,
            )
        )
    benchmark.sort(
        key=lambda row: (
            not row.enough_data,
            row.difference is None,
            -(row.difference or 0),
            row.agent.display_name,
        )
    )
    return NetworkKpis(
        months=[MonthKpiRead(**read_month(row)) for row in network],
        network_flag_rate=network_rate,
        min_registrations=config.min_users_for_band,
        benchmark=benchmark,
    )
