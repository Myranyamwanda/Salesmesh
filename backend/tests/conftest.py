from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.services.firebase import (
    FirebaseIdentity,
    FirebaseUnavailable,
    InvalidFirebaseToken,
)


class FakeFirebase:
    """In-memory stand-in for FirebaseAuth; tests never call real Firebase.

    An ID token is "token-<uid>". Set `available = False` to simulate an outage.
    """

    def __init__(self):
        self.users = {}  # uid -> {"email", "email_verified", "disabled"}
        self.revoked_tokens = set()
        self.revoked_uids = []
        self.deleted = []
        self.created = 0  # Numbers new uids; never reused after a delete.
        self.available = True

    def add_user(self, email, verified=True, uid=None, disabled=False):
        self.created += 1
        uid = uid or f"uid-{self.created}"
        self.users[uid] = {
            "email": email,
            "email_verified": verified,
            "disabled": disabled,
        }
        return uid

    def token(self, uid):
        return f"token-{uid}"

    def check_available(self):
        if not self.available:
            raise FirebaseUnavailable("UnavailableError")

    def verify(self, id_token):
        self.check_available()
        uid = id_token.removeprefix("token-")
        user = self.users.get(uid)
        if user is None or not id_token.startswith("token-"):
            raise InvalidFirebaseToken("invalid")
        if id_token in self.revoked_tokens:
            raise InvalidFirebaseToken("revoked")
        if user["disabled"]:
            raise InvalidFirebaseToken("disabled")
        return FirebaseIdentity(uid, user["email"], user["email_verified"])

    def find_uid(self, email):
        self.check_available()
        return next(
            (uid for uid, user in self.users.items() if user["email"] == email), None
        )

    def ensure_user(self, email):
        return self.find_uid(email) or self.add_user(email, verified=False)

    def upsert_password_user(self, email, password):
        self.check_available()
        uid = self.find_uid(email)
        created = uid is None
        uid = uid or self.add_user(email)
        self.users[uid].update(email_verified=True, disabled=False, password=password)
        return uid, created

    def email_of(self, uid):
        self.check_available()
        user = self.users.get(uid)
        return user["email"] if user else None

    def delete_user(self, uid):
        self.check_available()
        self.users.pop(uid, None)
        self.deleted.append(uid)

    def password_reset_link(self, email):
        self.check_available()
        return f"https://firebase.test/reset?email={email}"

    def set_disabled(self, uid, disabled):
        self.check_available()
        if uid in self.users:
            self.users[uid]["disabled"] = disabled
            if disabled:
                self.revoked_uids.append(uid)


@pytest.fixture
def fake_firebase():
    return FakeFirebase()


class FakeDns:
    """MX lookups without the network: every domain has a mail server unless
    `records[domain]` is [] (no MX) or None (DNS unreachable)."""

    def __init__(self):
        self.records = {}
        self.lookups = []

    def mx_hosts(self, domain, timeout, nameservers=()):
        self.lookups.append(domain)
        return self.records.get(domain, [f"mx.{domain}."])


@pytest.fixture(autouse=True)
def fake_dns(monkeypatch):
    fake = FakeDns()
    monkeypatch.setattr("app.services.email_checks.mx_hosts", fake.mx_hosts)
    return fake


def validate_test_database(settings) -> None:
    if (
        settings.test_postgres_db == settings.postgres_db
        or not settings.test_postgres_db.endswith("_test")
    ):
        raise ValueError("TEST_POSTGRES_DB must be a separate database ending in _test")


@pytest.fixture(scope="session")
def test_engine():
    settings = get_settings()
    validate_test_database(settings)
    engine = create_engine(
        settings.database_url.set(database=settings.test_postgres_db),
        hide_parameters=True,
        connect_args={"connect_timeout": settings.db_connect_timeout},
    )
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
    yield engine
    engine.dispose()


@pytest.fixture
def db_session(test_engine):
    with test_engine.connect() as connection:
        transaction = connection.begin()
        with Session(connection, join_transaction_mode="create_savepoint") as session:
            yield session
        transaction.rollback()
