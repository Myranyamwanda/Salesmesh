"""Public customer registration through an agent's referral link."""

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, Request
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session, aliased

from app.core.config import Settings
from app.ml.features import RegistrationData, build_features
from app.ml.model_service import ModelService
from app.models import AgentProfile, ClientProfile, Customer, User
from app.models.agent import REFERRAL_ALPHABET
from app.models.customer import (
    CONSENT_VERSION,
    REFERENCE_GROUP_LENGTH,
    REFERENCE_PREFIX,
)
from app.schemas.join import JoinRegistrationInput
from app.services.auth import active_user, client_address, hash_ip
from app.services.email_checks import check_permanent_email
from app.services.geoip import CountryLookup, request_country
from app.services.scoring import score_customer

INACTIVE_LINK = "This link is not active. Contact your agent."
# Separates these advisory locks from the login rate-limit locks.
JOIN_LOCK_NAMESPACE = 2


@dataclass(frozen=True)
class JoinLink:
    profile: AgentProfile
    client: User
    organisation_name: str


def link_is_active(
    agent: User, client: User | None, client_profile: ClientProfile | None
) -> bool:
    """The rule for a working referral link, shared with the admin Agents page.

    The agent must be approved, active, and verified (the same check as login)
    and still have the agent role. The agent must also work for an active
    client with an organisation name, because the consent text names that
    client as the organisation the customer's details are shared with.
    """
    return (
        agent.role == "agent"
        and active_user(agent)
        and client is not None
        and client.role == "client"
        and client.is_active
        and client_profile is not None
    )


def active_join_link(session: Session, code: str) -> JoinLink:
    """Return the agent and client behind a referral code, or one neutral 404.

    Every inactive case gives the same response, so the page never reveals why
    a link stopped working.
    """
    client = aliased(User)
    row = session.execute(
        select(AgentProfile, User, client, ClientProfile)
        .join(User, User.id == AgentProfile.user_id)
        .outerjoin(client, client.id == AgentProfile.client_id)
        .outerjoin(ClientProfile, ClientProfile.user_id == AgentProfile.client_id)
        .where(AgentProfile.referral_code == code.upper())
    ).first()
    if row is None or not link_is_active(row[1], row[2], row[3]):
        raise HTTPException(404, INACTIVE_LINK)
    profile, _, client_user, client_profile = row
    return JoinLink(profile, client_user, client_profile.organisation_name)


def new_reference() -> str:
    """Return a random reference such as SM-7K3Q-9XPA.

    secrets (not random) makes references unpredictable, and the demo seed's
    random generator is never touched, so seeded data stays reproducible.
    """
    groups = (
        "".join(
            secrets.choice(REFERRAL_ALPHABET) for _ in range(REFERENCE_GROUP_LENGTH)
        )
        for _ in range(2)
    )
    return REFERENCE_PREFIX + "-".join(groups)


def unique_reference(session: Session) -> str:
    # About 8.5 * 10^11 references; the unique constraint is the final guard.
    for _ in range(5):
        reference = new_reference()
        taken = session.scalar(
            select(Customer.id).where(Customer.reference == reference)
        )
        if taken is None:
            return reference
    raise RuntimeError("Could not generate a unique registration reference")


def check_join_rate(session: Session, ip_hash: str, settings: Settings) -> None:
    """Allow at most join_rate_limit registrations per IP in the window."""
    session.execute(
        text("SELECT pg_advisory_xact_lock(:namespace, :key)"),
        {"namespace": JOIN_LOCK_NAMESPACE, "key": int(ip_hash[:7], 16)},
    )
    since = datetime.now(UTC) - timedelta(seconds=settings.join_rate_window_seconds)
    recent = session.scalar(
        select(func.count())
        .select_from(Customer)
        .where(Customer.ip_address_hash == ip_hash, Customer.created_at >= since)
    )
    if recent >= settings.join_rate_limit:
        raise HTTPException(
            429,
            "Too many registrations from this network. Try again later.",
            headers={"Retry-After": str(settings.join_rate_window_seconds)},
        )


def register_customer(
    session: Session,
    request: Request,
    settings: Settings,
    model_service: ModelService,
    lookup: CountryLookup,
    code: str,
    payload: JoinRegistrationInput,
    signed_in: User | None,
) -> Customer:
    """Save the customer, build the features, and score them in one transaction.

    Raises ModelUnavailableError (nothing is saved) when the model is not ok.
    """
    link = active_join_link(session, code)
    profile = link.profile
    if payload.assisted and (signed_in is None or signed_in.id != profile.user_id):
        raise HTTPException(
            403, "Assisted registration requires the agent to be signed in"
        )
    model_service.ready_state()  # Fail before any work if the model is down.

    address = client_address(request)
    ip_hash = hash_ip(address, settings)
    # Agents register many customers from one network, so assisted mode is
    # exempt; the agent is authenticated instead.
    if not payload.assisted:
        check_join_rate(session, ip_hash, settings)

    now = datetime.now(UTC)
    email = str(payload.email).lower()
    # After the rate limit, so the DNS lookup cannot be used freely.
    check_permanent_email(email, settings)
    data = RegistrationData(
        full_name=payload.full_name,
        email=email,
        mobile_phone=payload.mobile_phone,
        secondary_phone=payload.secondary_phone,
        date_of_birth=payload.date_of_birth,
        country=payload.country,
        current_address_months=payload.current_address_months,
        previous_address_months=payload.previous_address_months,
        keep_signed_in=payload.keep_signed_in,
        session_length_minutes=payload.session_length_minutes,
        device_id=payload.device_id,
        user_agent=payload.user_agent,
        ip_country=request_country(lookup, address),
        assisted=payload.assisted,
    )
    features = build_features(
        session,
        data,
        settings.free_email_domain_set,
        settings.phone_default_region,
        now,
    )
    customer = Customer(
        agent_id=profile.user_id,
        client_id=link.client.id,
        reference=unique_reference(session),
        full_name=payload.full_name,
        email=email,
        mobile_phone=payload.mobile_phone,
        secondary_phone=payload.secondary_phone,
        date_of_birth=payload.date_of_birth,
        country=payload.country,
        current_address_months=payload.current_address_months,
        previous_address_months=payload.previous_address_months,
        device_id=payload.device_id,
        ip_address_hash=ip_hash,
        assisted=payload.assisted,
        consent_at=now,
        consent_version=CONSENT_VERSION,
        created_at=now,
    )
    session.add(customer)
    session.flush()
    score_customer(session, model_service, customer, features)
    session.commit()
    return customer
