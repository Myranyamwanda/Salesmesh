"""Public customer registration through an agent's referral link."""

from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, Request
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.ml.features import RegistrationData, build_features
from app.ml.model_service import ModelService
from app.models import AgentProfile, Customer, User
from app.schemas.join import JoinRegistrationInput
from app.services.auth import active_user, client_address, hash_ip
from app.services.email_checks import check_permanent_email
from app.services.geoip import CountryLookup, request_country
from app.services.scoring import score_customer

INACTIVE_LINK = "This link is not active"
# Separates these advisory locks from the login rate-limit locks.
JOIN_LOCK_NAMESPACE = 2


def active_agent_profile(session: Session, code: str) -> AgentProfile:
    """Return the profile behind a referral code, or raise one neutral 404.

    The link works only for an agent who is approved, active, and verified
    (the same check as login). Every other case gives the same response, so
    the page never reveals why a link stopped working.
    """
    row = session.execute(
        select(AgentProfile, User)
        .join(User, User.id == AgentProfile.user_id)
        .where(AgentProfile.referral_code == code.upper())
    ).first()
    if row is None or row.User.role != "agent" or not active_user(row.User):
        raise HTTPException(404, INACTIVE_LINK)
    return row.AgentProfile


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
    profile = active_agent_profile(session, code)
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
        created_at=now,
    )
    session.add(customer)
    session.flush()
    score_customer(session, model_service, customer, features)
    session.commit()
    return customer
