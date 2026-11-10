"""Demo data for presentations: 1 admin, 3 clients, 41 agents, and their customers.

DEMO ONLY. Each customer's 11 feature values are read straight from
ml/model_contract/v2/demo_sample.csv (real BAF test rows) instead of being built
from a registration by app/ml/features.py. Names, emails, phone numbers, and
dates of birth are invented by Faker for display only. Every customer is then
scored by the same score_customer() as the live API (real model, clipping,
rules, and reasons), and older flags are reviewed through the same review
service as the API.

fraud_bool (the dataset's true label) is used only to give fraudulent agents
their fraud rows and for the automatic demo reviews. It is never stored as a
feature, and neither is customer_age.

Agent 41 abuses assisted mode: most of its customers are registered on its own
device, and many of those are fraud rows, so the assisted safeguards (threshold,
random audit, and the assisted-share alert) show on a genuinely fraudulent
agent. With model v2 it is caught by the alert and the audits, not by a low
reputation; honest agent 39 gets the same alert and is the false-alarm example.
It is built after the first 40 agents, from rows they did not use, with its own
seeded generators, so the first 40 agents' data does not change.
Random audits use another seeded generator for the same reason.

Every demo user also gets a Firebase account (verified, DEMO_PASSWORD), and the
demo admin gets an authenticator secret. Firebase calls never use the seeded
random generator, so the customers, scores, and reviews do not change. Only
@demo.example.com addresses are ever created or deleted in Firebase.
"""

import csv
import random
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pyotp
from faker import Faker
from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from app.core.config import ROOT_DIR, Settings
from app.core.security import validate_password
from app.ml.features import ASSISTED_UNKNOWN, FEATURE_NAMES
from app.ml.model_service import ModelService
from app.models import AgentProfile, ClientProfile, Customer, ScoringConfig, User
from app.models.customer import CONSENT_VERSION
from app.services.agents import create_agent_profile
from app.services.auth import usable_admins
from app.services.firebase import FirebaseAuth
from app.services.mfa import encrypt_secret, provisioning_uri
from app.services.registration import unique_reference
from app.services.reputation import agent_reputations
from app.services.reviews import apply_review
from app.services.scoring import score_customer

# example.com is reserved for examples (RFC 2606) and can never receive mail.
# (.test is reserved too, but email validation rejects it, so logins fail.)
DEMO_DOMAIN = "demo.example.com"
DEMO_SAMPLE = ROOT_DIR / "ml" / "model_contract" / "v2" / "demo_sample.csv"
REVIEW_NOTE = "Demo review based on dataset label"
DEMO_LOCK = 71024
CATEGORICAL = ("source", "device_os")


@dataclass(frozen=True)
class DemoPlan:
    """How much demo data to create. Tests use a smaller plan."""

    agents: int = 40
    # 1-based agent numbers; spread so every client has a fraudulent agent.
    fraudulent_agents: tuple[int, ...] = (4, 15, 26, 37)
    # Honest agents kept below min_users_for_band to show "Insufficient data".
    small_agents: tuple[int, ...] = (10, 20, 30)
    clients: int = 3
    fraudulent_customers: int = 100
    fraudulent_share: float = 0.40
    honest_customers: tuple[int, int] = (30, 150)
    small_customers: tuple[int, int] = (8, 25)
    assisted_share: float = 0.10
    history_days: int = 365
    # Flags older than this are reviewed automatically; newer ones stay pending.
    auto_review_after: timedelta = timedelta(days=60)
    seed: int = 2026
    # The extra agent that abuses assisted mode (0 customers: no such agent).
    abuser_customers: int = 60
    abuser_assisted_share: float = 0.6
    # Share of fraud rows among the abuser's assisted registrations.
    abuser_fraud_share: float = 0.4

    @property
    def abuser(self) -> int | None:
        """The abuser's agent number, after the regular agents."""
        return self.agents + 1 if self.abuser_customers else None


@dataclass(frozen=True)
class DemoRow:
    features: dict[str, Any]
    fraud_bool: int


@dataclass
class DemoSummary:
    created: bool
    customers: int = 0
    flagged: int = 0
    audited: int = 0
    reviewed: Counter = field(default_factory=Counter)
    pending: int = 0
    bands: Counter = field(default_factory=Counter)
    # Firebase accounts created new vs. reused from an earlier run.
    firebase: Counter = field(default_factory=Counter)
    # Shown once so the presenter can add the demo admin to an authenticator.
    admin_totp_secret: str | None = None
    admin_otpauth_uri: str | None = None


def demo_email(local_part: str) -> str:
    return f"{local_part}@{DEMO_DOMAIN}"


def is_demo_email(email: str) -> bool:
    return email.endswith(f"@{DEMO_DOMAIN}")


def agent_email(number: int) -> str:
    return demo_email(f"agent{number:02d}")


def client_email(number: int) -> str:
    return demo_email(f"client{number}")


def client_organisation(number: int) -> str:
    # Fixed names: no seeded random value is used, so the customers stay the same.
    return f"Demo Client {number}"


ADMIN_EMAIL = demo_email("admin")


def planned_emails(plan: DemoPlan) -> list[str]:
    """Every demo account a plan creates: admin, clients, then agents."""
    return [
        ADMIN_EMAIL,
        *(client_email(number) for number in range(1, plan.clients + 1)),
        *(agent_email(number) for number in range(1, plan.agents + 1)),
        *([agent_email(plan.abuser)] if plan.abuser else []),
    ]


def require_demo_email(email: str) -> str:
    """The last guard before Firebase changes: never touch a real account."""
    if not is_demo_email(email):
        raise ValueError(f"Refusing to change a non-demo account in Firebase: {email}")
    return email


def parse_value(name: str, value: str) -> Any:
    if name in CATEGORICAL:
        return value or None
    return None if value == "" else float(value)


def read_sample(path: Path = DEMO_SAMPLE) -> list[DemoRow]:
    """Read the model's features and the label; customer_age is ignored."""
    with path.open(encoding="utf-8", newline="") as file:
        return [
            DemoRow(
                features={name: parse_value(name, row[name]) for name in FEATURE_NAMES},
                fraud_bool=int(row["fraud_bool"]),
            )
            for row in csv.DictReader(file)
        ]


def assign_rows(
    rows: list[DemoRow], plan: DemoPlan, rng: random.Random
) -> dict[int, list[DemoRow]]:
    """Give fraudulent agents about 40% fraud rows and honest agents random rows."""
    fraud = [row for row in rows if row.fraud_bool == 1]
    legit = [row for row in rows if row.fraud_bool == 0]
    rng.shuffle(fraud)
    rng.shuffle(legit)
    assigned: dict[int, list[DemoRow]] = {}
    fraud_each = round(plan.fraudulent_customers * plan.fraudulent_share)
    for number in plan.fraudulent_agents:
        taken = [fraud.pop() for _ in range(fraud_each)] + [
            legit.pop() for _ in range(plan.fraudulent_customers - fraud_each)
        ]
        rng.shuffle(taken)
        assigned[number] = taken
    pool = fraud + legit
    rng.shuffle(pool)
    for number in range(1, plan.agents + 1):
        if number in assigned:
            continue
        low, high = (
            plan.small_customers
            if number in plan.small_agents
            else plan.honest_customers
        )
        size = min(rng.randint(low, high), len(pool))
        assigned[number] = [pool.pop() for _ in range(size)]
    return assigned


def abuser_rows(
    rows: list[DemoRow],
    assigned: dict[int, list[DemoRow]],
    plan: DemoPlan,
    rng: random.Random,
) -> list[tuple[DemoRow, bool]]:
    """The abuser's rows and whether each is assisted, from rows not yet used.

    Assisted rows are fraud at abuser_fraud_share; the rest are genuine.
    """
    used = {id(row) for agent_rows in assigned.values() for row in agent_rows}
    left = [row for row in rows if id(row) not in used]
    fraud = [row for row in left if row.fraud_bool == 1]
    legit = [row for row in left if row.fraud_bool == 0]
    rng.shuffle(fraud)
    rng.shuffle(legit)
    assisted = round(plan.abuser_customers * plan.abuser_assisted_share)
    fraud_count = round(assisted * plan.abuser_fraud_share)
    legit_count = plan.abuser_customers - fraud_count
    if len(fraud) < fraud_count or len(legit) < legit_count:
        raise ValueError("Not enough unused sample rows for the assisted-mode agent")
    planned = [(fraud.pop(), True) for _ in range(fraud_count)]
    planned += [(legit.pop(), True) for _ in range(assisted - fraud_count)]
    planned += [(legit.pop(), False) for _ in range(plan.abuser_customers - assisted)]
    rng.shuffle(planned)
    return planned


def is_demo_present(session: Session) -> bool:
    return session.scalar(select(User.id).where(User.email == ADMIN_EMAIL)) is not None


def new_user(email: str, role: str, uids: dict[str, str], now: datetime) -> User:
    # Demo emails cannot receive mail, so accounts start verified and approved.
    # They sign in through Firebase only; there is no local password.
    return User(
        email=email,
        firebase_uid=uids[email],
        role=role,
        status="approved",
        is_active=True,
        email_verified_at=now,
    )


def seed_demo(
    session: Session,
    model_service: ModelService,
    password: str,
    firebase: FirebaseAuth,
    settings: Settings,
    rows: list[DemoRow] | None = None,
    plan: DemoPlan | None = None,
    now: datetime | None = None,
) -> DemoSummary:
    """Create the demo data once. A second run changes nothing.

    The database part runs in one transaction: it either completes or leaves
    nothing behind. Firebase accounts are created first; if the database part
    then fails, a rerun reuses them instead of failing.
    """
    plan = plan or DemoPlan()
    validate_password(password)
    model_service.ready_state()  # Refuse to seed without a working model.
    session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": DEMO_LOCK})
    if is_demo_present(session):
        session.rollback()
        return DemoSummary(created=False)

    summary = DemoSummary(created=True)
    uids = {}
    for email in planned_emails(plan):
        uid, created = firebase.upsert_password_user(
            require_demo_email(email), password
        )
        uids[email] = uid
        summary.firebase["created" if created else "reused"] += 1

    now = now or datetime.now(UTC)
    rng = random.Random(plan.seed)
    fake = Faker("en_KE")
    fake.seed_instance(plan.seed)

    admin = new_user(ADMIN_EMAIL, "admin", uids, now)
    # The demo admin signs in like a real one, with an authenticator code.
    secret = pyotp.random_base32()
    admin.totp_secret_encrypted = encrypt_secret(secret, settings)
    admin.totp_enabled_at = now
    summary.admin_totp_secret = secret
    summary.admin_otpauth_uri = provisioning_uri(admin, secret)
    clients = [
        new_user(client_email(number), "client", uids, now)
        for number in range(1, plan.clients + 1)
    ]
    agents = {
        number: new_user(agent_email(number), "agent", uids, now)
        for number in range(1, plan.agents + 1)
    }
    abuser = (
        new_user(agent_email(plan.abuser), "agent", uids, now) if plan.abuser else None
    )
    session.add_all([admin, *clients, *agents.values(), *([abuser] if abuser else [])])
    session.flush()
    session.add_all(
        ClientProfile(user_id=client.id, organisation_name=client_organisation(number))
        for number, client in enumerate(clients, start=1)
    )
    agent_clients = {}
    for number, agent in agents.items():
        profile = create_agent_profile(session, agent, fake.name())
        profile.client_id = agent_clients[number] = clients[
            (number - 1) % plan.clients
        ].id
    # Generators for everything added after the first demo version, so the
    # values drawn from rng and fake above stay exactly as they were.
    audit_rng = random.Random(plan.seed + 1)
    abuser_rng = random.Random(plan.seed + 2)
    abuser_fake = Faker("en_KE")
    abuser_fake.seed_instance(plan.seed + 2)
    if abuser:
        profile = create_agent_profile(session, abuser, abuser_fake.name())
        profile.client_id = agent_clients[plan.abuser] = clients[
            (plan.abuser - 1) % plan.clients
        ].id
    session.flush()

    customer_number = 0

    def add_customer(number, row, created_at, assisted, names):
        nonlocal customer_number
        customer_number += 1
        features = dict(row.features)
        if assisted:
            # Same rule as a live assisted registration.
            features.update(dict.fromkeys(ASSISTED_UNKNOWN))
        current = features["current_address_months_count"]
        previous = features["prev_address_months_count"]
        customer = Customer(
            agent_id=(abuser if number == plan.abuser else agents[number]).id,
            client_id=agent_clients[number],
            # secrets, not the seeded generator: see unique_reference.
            reference=unique_reference(session),
            full_name=names.name(),
            email=demo_email(f"customer{customer_number:04d}"),
            mobile_phone=names.numerify("07## ### ###"),
            date_of_birth=names.date_of_birth(minimum_age=18, maximum_age=75),
            country="KE",
            # Display fields; a missing current address is shown as 0 months.
            current_address_months=int(current or 0),
            previous_address_months=None if previous is None else int(previous),
            assisted=assisted,
            consent_at=created_at,
            # Demo customers count as consenting to the current wording.
            consent_version=CONSENT_VERSION,
            created_at=created_at,
        )
        session.add(customer)
        session.flush()
        assessment = score_customer(
            session, model_service, customer, features, audit_rng.random
        )
        assessment.created_at = created_at
        session.flush()
        summary.customers += 1
        summary.flagged += assessment.flagged
        summary.audited += assessment.audit_selected
        if not (assessment.flagged or assessment.audit_selected):
            return
        # Audits are reviewed like flags: from the dataset label once old.
        if created_at < now - plan.auto_review_after:
            decision = "confirmed_fake" if row.fraud_bool else "confirmed_real"
            apply_review(session, None, admin, assessment, decision, REVIEW_NOTE)
            summary.reviewed[decision] += 1
        else:
            summary.pending += 1

    sample = rows or read_sample()
    assigned = assign_rows(sample, plan, rng)
    for number, agent_rows in assigned.items():
        for row in agent_rows:
            created_at = now - timedelta(
                seconds=rng.uniform(0, plan.history_days * 86400)
            )
            assisted = rng.random() < plan.assisted_share
            add_customer(number, row, created_at, assisted, fake)
    if abuser:
        for row, assisted in abuser_rows(sample, assigned, plan, abuser_rng):
            created_at = now - timedelta(
                seconds=abuser_rng.uniform(0, plan.history_days * 86400)
            )
            add_customer(plan.abuser, row, created_at, assisted, abuser_fake)

    config = session.get(ScoringConfig, 1)
    summary.bands = Counter(
        stats.band
        for stats in agent_reputations(
            session,
            config,
            [agent.id for agent in [*agents.values(), *([abuser] if abuser else [])]],
        ).values()
    )
    session.commit()
    return summary


def delete_demo_firebase_users(
    session: Session, firebase: FirebaseAuth, plan: DemoPlan
) -> int:
    """Delete the Firebase accounts of demo users; return how many were deleted.

    Safe in every state: a demo user without a stored uid is looked up by
    email, a missing account is skipped, and the planned demo addresses are
    checked too, so accounts left by an interrupted seed are removed. A stored
    uid is deleted only if Firebase confirms it belongs to a demo address.
    """
    deleted = 0
    stored = session.execute(
        select(User.email, User.firebase_uid).where(User.email.like(f"%@{DEMO_DOMAIN}"))
    ).all()
    seen = set()
    for email, uid in stored:
        require_demo_email(email)
        seen.add(email)
        owner = firebase.email_of(uid) if uid else None
        if owner is None or not is_demo_email(owner):
            uid = firebase.find_uid(email)
        if uid is not None:
            firebase.delete_user(uid)
            deleted += 1
    for email in planned_emails(plan):
        if email not in seen and (uid := firebase.find_uid(require_demo_email(email))):
            firebase.delete_user(uid)
            deleted += 1
    return deleted


def delete_demo_rows(session: Session) -> dict[str, int]:
    """Delete demo users and the customers of demo agents. The caller commits.

    Assessments and reviews go with their customers (ON DELETE CASCADE), and
    agent and client profiles with their users. Audit entries stay, with their
    links to demo users cleared (ON DELETE SET NULL); a real agent who worked
    for a demo client is unassigned.
    """
    demo_users = select(User.id).where(User.email.like(f"%@{DEMO_DOMAIN}"))
    customers = session.scalar(
        select(func.count())
        .select_from(Customer)
        .where(Customer.agent_id.in_(demo_users))
    )
    users = session.scalar(
        select(func.count()).select_from(User).where(User.id.in_(demo_users))
    )
    session.execute(delete(Customer).where(Customer.agent_id.in_(demo_users)))
    session.execute(delete(AgentProfile).where(AgentProfile.user_id.in_(demo_users)))
    session.execute(delete(User).where(User.id.in_(demo_users)))
    return {"customers": customers, "users": users}


def reset_demo(
    session: Session, firebase: FirebaseAuth, plan: DemoPlan | None = None
) -> dict[str, int]:
    """Delete only demo data: demo users, their Firebase accounts, and the
    customers of demo agents.

    Firebase accounts go first: if that fails, nothing in the database has
    changed and a rerun starts again.
    """
    session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": DEMO_LOCK})
    firebase_deleted = delete_demo_firebase_users(session, firebase, plan or DemoPlan())
    removed = delete_demo_rows(session)
    session.commit()
    return removed | {"firebase": firebase_deleted}


def clear_demo_data(session: Session) -> dict[str, int]:
    """Delete the demo data in this database only; Firebase is not touched.

    For a Firebase project shared by several environments (development and
    production): reset-demo would delete the demo accounts the other
    environment signs in with. The next seed-demo reuses the kept accounts.
    Refuses when no usable administrator outside the demo would remain.
    """
    session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": DEMO_LOCK})
    if usable_admins(session, User.email.not_like(f"%@{DEMO_DOMAIN}")) == 0:
        session.rollback()
        raise ValueError(
            "Refusing to clear the demo data: no usable administrator outside "
            "the demo would remain. Create one with create-admin first."
        )
    removed = delete_demo_rows(session)
    session.commit()
    return removed
