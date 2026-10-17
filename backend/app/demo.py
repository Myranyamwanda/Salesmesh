"""Demo data for presentations: 1 admin, 3 clients, 40 agents, and their customers.

DEMO ONLY. Each customer's 13 feature values are read straight from
ml/model_contract/demo_sample.csv (real BAF test rows) instead of being built
from a registration by app/ml/features.py. Names, emails, phone numbers, and
dates of birth are invented by Faker for display only. Every customer is then
scored by the same score_customer() as the live API (real model, clipping,
rules, and reasons), and older flags are reviewed through the same review
service as the API.

fraud_bool (the dataset's true label) is used only to give fraudulent agents
their fraud rows and for the automatic demo reviews. It is never stored as a
feature, and neither is customer_age.
"""

import csv
import random
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from faker import Faker
from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from app.core.config import ROOT_DIR
from app.core.security import hash_password, validate_password
from app.ml.features import ASSISTED_UNKNOWN, FEATURE_NAMES
from app.ml.model_service import ModelService
from app.models import AgentProfile, Customer, ScoringConfig, User
from app.services.agents import create_agent_profile
from app.services.reputation import agent_reputations
from app.services.reviews import apply_review
from app.services.scoring import score_customer

DEMO_DOMAIN = "demo.salesmesh.test"  # .test is reserved and can never receive mail
DEMO_SAMPLE = ROOT_DIR / "ml" / "model_contract" / "demo_sample.csv"
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


@dataclass(frozen=True)
class DemoRow:
    features: dict[str, Any]
    fraud_bool: int


@dataclass
class DemoSummary:
    created: bool
    customers: int = 0
    flagged: int = 0
    reviewed: Counter = field(default_factory=Counter)
    pending: int = 0
    bands: Counter = field(default_factory=Counter)


def demo_email(local_part: str) -> str:
    return f"{local_part}@{DEMO_DOMAIN}"


def is_demo_email(email: str) -> bool:
    return email.endswith(f"@{DEMO_DOMAIN}")


def agent_email(number: int) -> str:
    return demo_email(f"agent{number:02d}")


def client_email(number: int) -> str:
    return demo_email(f"client{number}")


ADMIN_EMAIL = demo_email("admin")


def parse_value(name: str, value: str) -> Any:
    if name in CATEGORICAL:
        return value or None
    return None if value == "" else float(value)


def read_sample(path: Path = DEMO_SAMPLE) -> list[DemoRow]:
    """Read the 13 features and the label; customer_age is ignored."""
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


def is_demo_present(session: Session) -> bool:
    return session.scalar(select(User.id).where(User.email == ADMIN_EMAIL)) is not None


def new_user(email: str, role: str, password_hash: str, now: datetime) -> User:
    # Demo emails cannot receive mail, so accounts start verified and approved.
    return User(
        email=email,
        password_hash=password_hash,
        role=role,
        status="approved",
        is_active=True,
        email_verified_at=now,
    )


def seed_demo(
    session: Session,
    model_service: ModelService,
    password: str,
    rows: list[DemoRow] | None = None,
    plan: DemoPlan | None = None,
    now: datetime | None = None,
) -> DemoSummary:
    """Create the demo data once. A second run changes nothing.

    Runs in one transaction: it either completes or leaves nothing behind.
    """
    plan = plan or DemoPlan()
    validate_password(password)
    model_service.ready_state()  # Refuse to seed without a working model.
    session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": DEMO_LOCK})
    if is_demo_present(session):
        session.rollback()
        return DemoSummary(created=False)

    now = now or datetime.now(UTC)
    rng = random.Random(plan.seed)
    fake = Faker("en_KE")
    fake.seed_instance(plan.seed)
    # One hash for every demo account: they share the published demo password.
    password_hash = hash_password(password)

    admin = new_user(ADMIN_EMAIL, "admin", password_hash, now)
    clients = [
        new_user(client_email(number), "client", password_hash, now)
        for number in range(1, plan.clients + 1)
    ]
    agents = {
        number: new_user(agent_email(number), "agent", password_hash, now)
        for number in range(1, plan.agents + 1)
    }
    session.add_all([admin, *clients, *agents.values()])
    session.flush()
    for number, agent in agents.items():
        profile = create_agent_profile(session, agent, fake.name())
        profile.client_id = clients[(number - 1) % plan.clients].id
    session.flush()

    summary = DemoSummary(created=True)
    customer_number = 0
    for number, agent_rows in assign_rows(rows or read_sample(), plan, rng).items():
        for row in agent_rows:
            customer_number += 1
            created_at = now - timedelta(
                seconds=rng.uniform(0, plan.history_days * 86400)
            )
            features = dict(row.features)
            assisted = rng.random() < plan.assisted_share
            if assisted:
                # Same rule as a live assisted registration.
                features.update(dict.fromkeys(ASSISTED_UNKNOWN))
            current = features["current_address_months_count"]
            previous = features["prev_address_months_count"]
            customer = Customer(
                agent_id=agents[number].id,
                full_name=fake.name(),
                email=demo_email(f"customer{customer_number:04d}"),
                mobile_phone=fake.numerify("07## ### ###"),
                date_of_birth=fake.date_of_birth(minimum_age=18, maximum_age=75),
                country="KE",
                # Display fields; a missing current address is shown as 0 months.
                current_address_months=int(current or 0),
                previous_address_months=None if previous is None else int(previous),
                assisted=assisted,
                consent_at=created_at,
                created_at=created_at,
            )
            session.add(customer)
            session.flush()
            assessment = score_customer(session, model_service, customer, features)
            assessment.created_at = created_at
            session.flush()
            summary.customers += 1
            if not assessment.flagged:
                continue
            summary.flagged += 1
            if created_at < now - plan.auto_review_after:
                decision = "confirmed_fake" if row.fraud_bool else "confirmed_real"
                apply_review(session, None, admin, assessment, decision, REVIEW_NOTE)
                summary.reviewed[decision] += 1
            else:
                summary.pending += 1

    config = session.get(ScoringConfig, 1)
    summary.bands = Counter(
        stats.band
        for stats in agent_reputations(
            session, config, [agent.id for agent in agents.values()]
        ).values()
    )
    session.commit()
    return summary


def reset_demo(session: Session) -> dict[str, int]:
    """Delete only demo data: demo users and the customers of demo agents.

    Assessments and reviews go with their customers (ON DELETE CASCADE), and
    agent profiles with their users. Audit entries stay, with their links to
    demo users cleared (ON DELETE SET NULL).
    """
    session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": DEMO_LOCK})
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
    session.commit()
    return {"customers": customers, "users": users}
