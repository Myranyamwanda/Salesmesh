import random
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pyotp
import pytest
from conftest import FakeFirebase
from cryptography.fernet import Fernet
from model_fixtures import tiny_state
from pydantic import SecretStr
from sqlalchemy import func, select
from test_auth import auth_context, bearer_headers  # noqa: F401
from test_domain_tables import make_customer, make_user
from test_firebase_auth import firebase_sign_in

from app.cli import demo_firebase
from app.core.config import get_settings
from app.demo import (
    ADMIN_EMAIL,
    REVIEW_NOTE,
    DemoPlan,
    DemoRow,
    agent_email,
    assign_rows,
    client_email,
    is_demo_email,
    planned_emails,
    read_sample,
    require_demo_email,
    reset_demo,
    seed_demo,
)
from app.ml.features import ASSISTED_UNKNOWN
from app.ml.model_service import ModelService, ModelUnavailableError
from app.models import AgentProfile, AuditLog, Customer, Review, RiskAssessment, User
from app.services.firebase import FirebaseUnavailable
from app.services.mfa import decrypt_secret

PASSWORD = "Demo-Password-2026!"
NOW = datetime(2026, 10, 15, 12, tzinfo=UTC)
ALWAYS_FLAG = 0.0
SMALL = DemoPlan(
    agents=6,
    fraudulent_agents=(2, 5),
    small_agents=(3,),
    clients=3,
    fraudulent_customers=10,
    honest_customers=(4, 6),
    small_customers=(1, 2),
    assisted_share=0.0,
    history_days=120,
    auto_review_after=timedelta(days=60),
)


@pytest.fixture(scope="module")
def sample():
    return read_sample()


SETTINGS = get_settings().model_copy(
    update={"totp_encryption_key": SecretStr(Fernet.generate_key().decode())}
)


def seed(
    session,
    sample,
    plan=SMALL,
    threshold=ALWAYS_FLAG,
    rows=None,
    firebase=None,
    settings=SETTINGS,
):
    return seed_demo(
        session,
        ModelService(tiny_state(threshold)),
        PASSWORD,
        firebase if firebase is not None else FakeFirebase(),
        settings,
        rows=rows or sample,
        plan=plan,
        now=NOW,
    )


def count(session, model, *where):
    return session.scalar(select(func.count()).select_from(model).where(*where))


def test_sample_has_features_and_labels_but_no_age(sample):
    assert len(sample) == 5000
    assert sum(row.fraud_bool for row in sample) == 300
    assert "customer_age" not in sample[0].features
    assert len(sample[0].features) == 13


def test_fraudulent_agents_get_forty_percent_fraud_rows(sample):
    assigned = assign_rows(sample, DemoPlan(), random.Random(1))
    for number in DemoPlan().fraudulent_agents:
        rows = assigned[number]
        assert len(rows) == 100
        assert sum(row.fraud_bool for row in rows) == 40
    for number in DemoPlan().small_agents:
        assert len(assigned[number]) < 30
    assert len(assigned) == 40


def test_demo_users_are_verified_approved_active(db_session, sample):
    summary = seed(db_session, sample)

    assert summary.created
    users = db_session.scalars(select(User).where(User.email.like("%@demo.%"))).all()
    assert len(users) == 1 + 3 + 6
    for user in users:
        assert is_demo_email(user.email)
        assert user.status == "approved"
        assert user.is_active
        assert user.email_verified_at is not None
    roles = {user.email: user.role for user in users}
    assert roles[ADMIN_EMAIL] == "admin"
    assert sorted(roles.values()).count("client") == 3


def test_agents_are_spread_over_three_clients(db_session, sample):
    seed(db_session, sample)
    client_ids = db_session.scalars(select(AgentProfile.client_id)).all()
    assert len(set(client_ids)) == 3
    assert None not in client_ids


def test_every_customer_is_scored_without_storing_the_label(db_session, sample):
    summary = seed(db_session, sample)
    customers = count(db_session, Customer)
    assert customers == summary.customers > 0
    assert count(db_session, RiskAssessment) == customers
    for features in db_session.scalars(select(RiskAssessment.features)):
        assert "fraud_bool" not in features
        assert "customer_age" not in features


def test_old_flags_are_reviewed_and_recent_flags_stay_pending(db_session, sample):
    summary = seed(db_session, sample)
    cutoff = NOW - SMALL.auto_review_after
    rows = db_session.execute(
        select(Customer, Review)
        .join(RiskAssessment, RiskAssessment.customer_id == Customer.id)
        .outerjoin(Review, Review.assessment_id == RiskAssessment.id)
    ).all()

    old = [
        (customer, review) for customer, review in rows if customer.created_at < cutoff
    ]
    recent = [
        (customer, review) for customer, review in rows if customer.created_at >= cutoff
    ]
    assert old and recent
    admin = db_session.scalar(select(User).where(User.email == ADMIN_EMAIL))
    for customer, review in old:
        assert review is not None
        assert review.reviewer_id == admin.id
        assert review.notes == REVIEW_NOTE
        expected = "rejected" if review.decision == "confirmed_fake" else "verified"
        assert customer.status == expected
    for customer, review in recent:
        assert review is None
        assert customer.status == "pending_review"
    assert summary.pending == len(recent)
    assert sum(summary.reviewed.values()) == len(old)
    # Reviews go through the same service as the API, so they are audited.
    assert count(db_session, AuditLog, AuditLog.action == "assessment_reviewed") == len(
        old
    )


@pytest.mark.parametrize(
    ("label", "decision"), [(1, "confirmed_fake"), (0, "confirmed_real")]
)
def test_automatic_reviews_follow_the_dataset_label(
    db_session, sample, label, decision
):
    rows = [DemoRow(features=sample[0].features, fraud_bool=label)] * 40
    plan = replace(SMALL, fraudulent_agents=(), small_agents=())
    seed(db_session, sample, plan=plan, rows=rows)
    decisions = set(db_session.scalars(select(Review.decision)))
    assert decisions == {decision}


def test_assisted_demo_customers_hide_device_features(db_session, sample):
    seed(db_session, sample, plan=replace(SMALL, assisted_share=1.0))
    assert count(db_session, Customer, Customer.assisted.is_(False)) == 0
    for features in db_session.scalars(select(RiskAssessment.features)):
        for name in ASSISTED_UNKNOWN:
            assert features[name] is None


def test_seed_is_safe_to_run_twice(db_session, sample):
    first = seed(db_session, sample)
    users = count(db_session, User)
    customers = count(db_session, Customer)

    second = seed(db_session, sample)

    assert first.created and not second.created
    assert count(db_session, User) == users
    assert count(db_session, Customer) == customers


def test_seed_refuses_without_a_ready_model(db_session, sample):
    with pytest.raises(ModelUnavailableError):
        seed_demo(
            db_session,
            ModelService(),
            PASSWORD,
            FakeFirebase(),
            SETTINGS,
            rows=sample,
            plan=SMALL,
        )
    assert count(db_session, User) == 0


def test_seed_refuses_a_weak_password(db_session, sample):
    with pytest.raises(ValueError):
        seed_demo(
            db_session,
            ModelService(tiny_state()),
            "weak",
            FakeFirebase(),
            SETTINGS,
            rows=sample,
            plan=SMALL,
        )


def test_reset_removes_only_demo_data(db_session, sample):
    real_agent = make_user(db_session)
    real_customer = make_customer(db_session, real_agent)
    db_session.commit()
    seed(db_session, sample)
    demo_client = db_session.scalar(
        select(User).where(User.email == "client1@demo.example.com")
    )
    real_profile = AgentProfile(
        user_id=real_agent.id,
        referral_code="AGT-ABCDEFGH",
        display_name="Real Agent",
        client_id=demo_client.id,
    )
    db_session.add(real_profile)
    db_session.commit()

    removed = reset_demo(db_session, FakeFirebase(), SMALL)

    assert removed["users"] == 1 + 3 + 6
    assert removed["customers"] > 0
    db_session.expire_all()
    assert count(db_session, User, User.email.like("%@demo.example.com")) == 0
    assert count(db_session, Review) == 0
    assert db_session.get(User, real_agent.id) is not None
    assert db_session.get(Customer, real_customer.id) is not None
    # A real agent who worked for a demo client is simply unassigned.
    assert db_session.get(AgentProfile, real_agent.id).client_id is None
    # A reset can be followed by a fresh seed.
    assert seed(db_session, sample).created


def customer_snapshot(session):
    """What a presenter sees: customers, scores, and review decisions."""
    rows = session.execute(
        select(Customer, RiskAssessment, Review)
        .join(RiskAssessment, RiskAssessment.customer_id == Customer.id)
        .outerjoin(Review, Review.assessment_id == RiskAssessment.id)
        .order_by(Customer.email)
    ).all()
    return [
        (
            customer.email,
            customer.full_name,
            customer.mobile_phone,
            customer.date_of_birth,
            customer.assisted,
            customer.status,
            assessment.probability,
            assessment.flagged,
            assessment.features,
            review.decision if review else None,
        )
        for customer, assessment, review in rows
    ]


def test_demo_users_get_verified_firebase_accounts(db_session, sample):
    firebase = FakeFirebase()
    summary = seed(db_session, sample, firebase=firebase)
    users = db_session.scalars(select(User)).all()
    assert len(users) == 10 == summary.firebase["created"]
    for user in users:
        account = firebase.users[user.firebase_uid]
        assert account["email"] == user.email
        assert account["email_verified"] and account["password"] == PASSWORD
        # Firebase-only sign-in: no local password is stored.
        assert user.password_hash is None


def test_existing_demo_firebase_accounts_are_reused(db_session, sample):
    firebase = FakeFirebase()
    old_uid = firebase.add_user(ADMIN_EMAIL, verified=False, disabled=True)
    summary = seed(db_session, sample, firebase=firebase)
    admin = db_session.scalar(select(User).where(User.email == ADMIN_EMAIL))
    assert admin.firebase_uid == old_uid
    assert firebase.users[old_uid]["email_verified"] is True
    assert firebase.users[old_uid]["disabled"] is False
    assert (summary.firebase["reused"], summary.firebase["created"]) == (1, 9)


def test_customer_data_does_not_depend_on_firebase(db_session, sample):
    seed(db_session, sample)
    first = customer_snapshot(db_session)
    reset_demo(db_session, FakeFirebase(), SMALL)
    firebase = FakeFirebase()
    for email in planned_emails(SMALL)[:4]:
        firebase.add_user(email)
    seed(db_session, sample, firebase=firebase)
    assert customer_snapshot(db_session) == first


def test_demo_admin_has_an_authenticator(db_session, sample):
    summary = seed(db_session, sample)
    admin = db_session.scalar(select(User).where(User.email == ADMIN_EMAIL))
    assert admin.totp_enabled_at is not None
    assert decrypt_secret(admin.totp_secret_encrypted, SETTINGS) == (
        summary.admin_totp_secret
    )
    assert summary.admin_otpauth_uri.startswith(
        "otpauth://totp/SalesMesh:admin%40demo.example.com?"
    )
    # A rerun adds nothing and never shows the secret again.
    assert seed(db_session, sample).admin_totp_secret is None


def test_seed_with_firebase_down_leaves_no_users(db_session, sample):
    firebase = FakeFirebase()
    firebase.available = False
    with pytest.raises(FirebaseUnavailable):
        seed(db_session, sample, firebase=firebase)
    db_session.rollback()
    assert count(db_session, User) == 0


def test_demo_commands_refuse_without_firebase_credentials():
    settings = SETTINGS.model_copy(
        update={"firebase_project_id": None, "firebase_credentials_path": None}
    )
    with pytest.raises(RuntimeError, match="demo commands need the Firebase"):
        demo_firebase(settings)


def test_only_demo_addresses_are_ever_changed_in_firebase():
    assert require_demo_email("agent01@demo.example.com")
    for email in ("admin@example.com", "name+admin@gmail.com", "x@demo.example.org"):
        with pytest.raises(ValueError, match="non-demo"):
            require_demo_email(email)


def test_reset_deletes_demo_firebase_accounts_in_every_state(db_session, sample):
    firebase = FakeFirebase()
    seed(db_session, sample, firebase=firebase)
    real_uid = firebase.add_user("name+admin@gmail.com")
    real_admin = User(email="name+admin@gmail.com", firebase_uid=real_uid, role="admin")
    db_session.add(real_admin)
    users = {
        user.email: user
        for user in db_session.scalars(
            select(User).where(User.email.like("%@demo.example.com"))
        )
    }
    # No stored uid: found by email.
    users[client_email(1)].firebase_uid = None
    # No Firebase account at all: skipped.
    firebase.users.pop(users[client_email(2)].firebase_uid)
    users[client_email(2)].firebase_uid = None
    # A stored uid that points at a real account is never deleted; the demo
    # address's own account is found by email instead.
    other_real_uid = firebase.add_user("someone@gmail.com")
    agent_uid = users[agent_email(1)].firebase_uid
    users[agent_email(1)].firebase_uid = other_real_uid
    db_session.commit()
    # A demo Firebase account with no SalesMesh user (an interrupted seed of
    # the full 40-agent plan, which the reset checks by default).
    orphan = firebase.add_user(agent_email(7))

    removed = reset_demo(db_session, firebase)

    assert firebase.users[real_uid]["email"] == "name+admin@gmail.com"
    assert firebase.users[other_real_uid]["email"] == "someone@gmail.com"
    assert agent_uid in firebase.deleted and orphan in firebase.deleted
    assert not any(is_demo_email(user["email"]) for user in firebase.users.values())
    # 10 seeded accounts, minus the one already missing, plus the orphan.
    assert removed["firebase"] == 10
    assert db_session.get(User, real_admin.id).firebase_uid == real_uid
    # Running it again with nothing left is harmless.
    assert reset_demo(db_session, firebase)["firebase"] == 0


def test_demo_accounts_can_sign_in(auth_context, fake_firebase, sample):  # noqa: F811
    client, session, _, settings = auth_context
    summary = seed(session, sample, firebase=fake_firebase, settings=settings)
    for email in (agent_email(1), client_email(1)):
        uid = session.scalar(select(User.firebase_uid).where(User.email == email))
        response = firebase_sign_in(client, fake_firebase, uid)
        assert response.status_code == 200, email
        assert "access_token" in response.json()
    admin_uid = session.scalar(
        select(User.firebase_uid).where(User.email == ADMIN_EMAIL)
    )
    challenge = firebase_sign_in(client, fake_firebase, admin_uid).json()
    assert challenge["mfa"] == "verify"
    code = pyotp.TOTP(summary.admin_totp_secret).now()
    response = client.post(
        "/auth/mfa/verify", json={"mfa_token": challenge["mfa_token"], "code": code}
    )
    assert response.status_code == 200
    me = client.get("/auth/me", headers=bearer_headers(response))
    assert me.json()["email"] == ADMIN_EMAIL
