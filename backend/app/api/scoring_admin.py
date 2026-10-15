"""Admin endpoints for reviews, agent reputation, and scoring settings."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from app.auth import Database, require_roles
from app.models import (
    AgentProfile,
    Customer,
    Review,
    RiskAssessment,
    ScoringConfig,
    User,
)
from app.schemas.scoring import (
    AgentCustomer,
    AgentDetail,
    AgentProfileUpdate,
    AgentRanking,
    AgentSummary,
    AssessmentDetail,
    ClientSummary,
    CustomerDetail,
    QueueItem,
    QueuePage,
    ReviewInput,
    ReviewRead,
    ScoringConfigInput,
    ScoringConfigRead,
)
from app.services.audit import audit
from app.services.reputation import AgentReputation, agent_reputations
from app.services.reviews import review_assessment

router = APIRouter(prefix="/admin", tags=["Scoring administration"])
type Admin = Annotated[User, Depends(require_roles("admin"))]
type Offset = Annotated[int, Query(ge=0)]
type Limit = Annotated[int, Query(ge=1, le=100)]


@router.get("/review-queue", response_model=QueuePage)
def review_queue(
    session: Database, _: Admin, offset: Offset = 0, limit: Limit = 25
) -> QueuePage:
    """Flagged assessments without a review, oldest first."""
    waiting = (
        select(RiskAssessment, Customer, AgentProfile)
        .join(Customer, Customer.id == RiskAssessment.customer_id)
        .join(AgentProfile, AgentProfile.user_id == Customer.agent_id)
        .outerjoin(Review, Review.assessment_id == RiskAssessment.id)
        .where(RiskAssessment.flagged, Review.id.is_(None))
    )
    total = session.scalar(select(func.count()).select_from(waiting.subquery()))
    rows = session.execute(
        waiting.order_by(RiskAssessment.created_at, RiskAssessment.id)
        .offset(offset)
        .limit(limit)
    )
    items = [
        QueueItem(
            assessment_id=assessment.id,
            created_at=assessment.created_at,
            probability=assessment.probability,
            threshold=assessment.threshold,
            reasons=assessment.reasons[:3],
            customer_name=customer.full_name,
            agent=AgentSummary(id=profile.user_id, display_name=profile.display_name),
        )
        for assessment, customer, profile in rows
    ]
    return QueuePage(items=items, total=total)


@router.get("/assessments/{assessment_id}", response_model=AssessmentDetail)
def read_assessment(
    assessment_id: UUID, session: Database, _: Admin
) -> AssessmentDetail:
    assessment = session.get(RiskAssessment, assessment_id)
    if assessment is None:
        raise HTTPException(404, "Assessment not found")
    customer = session.get(Customer, assessment.customer_id)
    profile = session.get(AgentProfile, customer.agent_id)
    review = session.scalar(select(Review).where(Review.assessment_id == assessment.id))
    return AssessmentDetail(
        id=assessment.id,
        model_version=assessment.model_version,
        probability=assessment.probability,
        threshold=assessment.threshold,
        flagged=assessment.flagged,
        reasons=assessment.reasons,
        features=assessment.features,
        created_at=assessment.created_at,
        customer=CustomerDetail.model_validate(customer),
        agent=AgentSummary(id=profile.user_id, display_name=profile.display_name),
        review=ReviewRead.model_validate(review) if review else None,
    )


@router.post(
    "/assessments/{assessment_id}/review", response_model=ReviewRead, status_code=201
)
def review(
    assessment_id: UUID,
    payload: ReviewInput,
    request: Request,
    session: Database,
    actor: Admin,
) -> ReviewRead:
    created = review_assessment(
        session, request, actor, assessment_id, payload.decision, payload.notes
    )
    return ReviewRead.model_validate(created)


def config_row(session) -> ScoringConfig:
    return session.get(ScoringConfig, 1)


def agent_rows(session, agent_id: UUID | None = None):
    """Agent profiles with their user account and assigned client."""
    client = aliased(User)
    query = (
        select(AgentProfile, User, client)
        .join(User, User.id == AgentProfile.user_id)
        .outerjoin(client, client.id == AgentProfile.client_id)
        .where(User.role == "agent")
    )
    if agent_id is not None:
        query = query.where(AgentProfile.user_id == agent_id)
    return session.execute(query).all()


def ranking(profile, user, client, stats: AgentReputation) -> AgentRanking:
    return AgentRanking(
        id=profile.user_id,
        display_name=profile.display_name,
        email=user.email,
        referral_code=profile.referral_code,
        status=user.status,
        is_active=user.is_active,
        client=ClientSummary(id=client.id, email=client.email) if client else None,
        n_users=stats.n_users,
        flags=stats.flags,
        confirmed_fake=stats.confirmed_fake,
        pending_review=stats.pending_review,
        assisted_share=stats.assisted_share,
        reputation=stats.reputation,
        risk_score=stats.risk_score,
        band=stats.band,
    )


@router.get("/agents", response_model=list[AgentRanking])
def list_agents(session: Database, _: Admin) -> list[AgentRanking]:
    """Every agent with reputation, lowest (most at risk) first."""
    stats = agent_reputations(session, config_row(session))
    rows = [
        ranking(profile, user, client, stats[profile.user_id])
        for profile, user, client in agent_rows(session)
    ]
    return sorted(rows, key=lambda row: (row.reputation, row.display_name))


def find_agent(session, agent_id: UUID):
    rows = agent_rows(session, agent_id)
    if not rows:
        raise HTTPException(404, "Agent not found")
    return rows[0]


@router.get("/agents/{agent_id}", response_model=AgentDetail)
def read_agent(
    agent_id: UUID, session: Database, _: Admin, offset: Offset = 0, limit: Limit = 25
) -> AgentDetail:
    profile, user, client = find_agent(session, agent_id)
    stats = agent_reputations(session, config_row(session), [agent_id])[agent_id]
    rows = session.execute(
        select(Customer, RiskAssessment)
        .outerjoin(RiskAssessment, RiskAssessment.customer_id == Customer.id)
        .where(Customer.agent_id == agent_id)
        .order_by(Customer.created_at.desc(), Customer.id)
        .offset(offset)
        .limit(limit)
    )
    customers = [
        AgentCustomer(
            id=customer.id,
            full_name=customer.full_name,
            created_at=customer.created_at,
            status=customer.status,
            assisted=customer.assisted,
            assessment_id=assessment.id if assessment else None,
            probability=assessment.probability if assessment else None,
            flagged=assessment.flagged if assessment else None,
        )
        for customer, assessment in rows
    ]
    return AgentDetail(
        **ranking(profile, user, client, stats).model_dump(),
        customers=customers,
        customers_total=stats.n_users,
    )


@router.patch("/agents/{agent_id}", response_model=AgentDetail)
def update_agent(
    agent_id: UUID,
    payload: AgentProfileUpdate,
    request: Request,
    session: Database,
    actor: Admin,
) -> AgentDetail:
    """Change the display name and/or the client the agent works for."""
    profile, user, _ = find_agent(session, agent_id)
    changes = payload.model_fields_set
    if "display_name" in changes:
        if payload.display_name is None:
            raise HTTPException(422, "Display name cannot be empty")
        profile.display_name = payload.display_name
    if "client_id" in changes:
        if payload.client_id is not None:
            client = session.get(User, payload.client_id)
            if client is None or client.role != "client":
                audit(session, request, "agent_profile_updated", "failure", actor, user)
                session.commit()
                raise HTTPException(422, "client_id must be a client account")
        profile.client_id = payload.client_id
    audit(session, request, "agent_profile_updated", actor=actor, target=user)
    session.commit()
    return read_agent(agent_id, session, actor)


@router.get("/scoring-config", response_model=ScoringConfigRead)
def read_scoring_config(session: Database, _: Admin) -> ScoringConfig:
    return config_row(session)


@router.put("/scoring-config", response_model=ScoringConfigRead)
def update_scoring_config(
    payload: ScoringConfigInput, request: Request, session: Database, actor: Admin
) -> ScoringConfig:
    """Replace all settings; reputations change immediately (computed on read)."""
    config = config_row(session)
    for name, value in payload.model_dump().items():
        setattr(config, name, value)
    config.updated_by = actor.id
    audit(
        session,
        request,
        "scoring_config_updated",
        actor=actor,
        subject="scoring_config:1",
    )
    session.commit()
    session.refresh(config)
    return config
