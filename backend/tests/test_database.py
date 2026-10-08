from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from conftest import validate_test_database
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select
from sqlalchemy.exc import IntegrityError

from alembic import command
from app.core.config import get_settings
from app.db.session import get_db
from app.main import create_app
from app.models import AuditLog, PasswordResetToken, RefreshToken, User


def test_schema_has_only_authentication_and_audit_tables(test_engine):
    assert set(inspect(test_engine).get_table_names()) == {
        "users",
        "refresh_tokens",
        "password_reset_tokens",
        "audit_logs",
        "alembic_version",
    }


def test_health_uses_real_test_database(db_session):
    application = create_app()
    application.dependency_overrides[get_db] = lambda: db_session
    response = TestClient(application).get("/health")
    assert response.status_code == 200
    assert response.json()["database"] == "ok"


def test_authentication_storage(db_session):
    user = User(
        email=f"{uuid4()}@example.test", password_hash="hash-only", role="agent"
    )
    db_session.add(user)
    db_session.flush()
    assert user.status == "pending"
    assert user.email_verified_at is None
    expires = datetime.now(UTC) + timedelta(days=1)
    db_session.add_all(
        [
            RefreshToken(
                user_id=user.id,
                session_id=uuid4(),
                token_hash="a" * 64,
                expires_at=expires,
            ),
            PasswordResetToken(
                user_id=user.id, token_hash="b" * 64, expires_at=expires
            ),
            AuditLog(
                actor_user_id=user.id,
                target_user_id=user.id,
                action="test",
                outcome="success",
            ),
        ]
    )
    db_session.commit()
    assert db_session.scalar(select(RefreshToken)).user_id == user.id
    assert db_session.scalar(select(PasswordResetToken)).used_at is None
    assert db_session.scalar(select(AuditLog)).actor_user_id == user.id


@pytest.mark.parametrize("role", ["unknown", "ADMIN"])
def test_database_rejects_invalid_roles(db_session, role):
    db_session.add(User(email="invalid@example.test", password_hash="hash", role=role))
    with pytest.raises(IntegrityError):
        db_session.flush()


def test_database_rejects_duplicate_email(db_session):
    db_session.add(
        User(email="unique@example.test", password_hash="hash", role="client")
    )
    db_session.flush()
    db_session.add(
        User(email="unique@example.test", password_hash="hash", role="admin")
    )
    with pytest.raises(IntegrityError):
        db_session.flush()


def test_test_database_guard():
    settings = get_settings().model_copy(
        update={"test_postgres_db": get_settings().postgres_db}
    )
    with pytest.raises(ValueError):
        validate_test_database(settings)


def test_database_rejects_invalid_status(db_session):
    db_session.add(
        User(
            email="status@example.test",
            password_hash="hash",
            role="agent",
            status="unknown",
        )
    )
    with pytest.raises(IntegrityError):
        db_session.flush()


def test_tokens_require_existing_user(db_session):
    db_session.add(
        PasswordResetToken(
            user_id=uuid4(), token_hash="c" * 64, expires_at=datetime.now(UTC)
        )
    )
    with pytest.raises(IntegrityError):
        db_session.flush()


def test_user_deletion_removes_tokens_but_retains_audit(db_session):
    user = User(email="delete@example.test", password_hash="hash", role="client")
    db_session.add(user)
    db_session.flush()
    db_session.add_all(
        [
            PasswordResetToken(
                user_id=user.id, token_hash="d" * 64, expires_at=datetime.now(UTC)
            ),
            RefreshToken(
                user_id=user.id,
                session_id=uuid4(),
                token_hash="e" * 64,
                expires_at=datetime.now(UTC),
            ),
            AuditLog(
                actor_user_id=user.id,
                target_user_id=user.id,
                action="test",
                outcome="success",
            ),
        ]
    )
    db_session.flush()
    db_session.delete(user)
    db_session.flush()
    db_session.expire_all()
    assert db_session.scalar(select(PasswordResetToken)) is None
    assert db_session.scalar(select(RefreshToken)) is None
    audit = db_session.scalar(select(AuditLog))
    assert audit.actor_user_id is None
    assert audit.target_user_id is None


def test_migrations_round_trip_on_test_database(test_engine):
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    with test_engine.begin() as connection:
        config.attributes["connection"] = connection
        command.downgrade(config, "base")
        assert inspect(connection).get_table_names() == ["alembic_version"]
        command.upgrade(config, "head")
        command.check(config)
    settings = get_settings().model_copy(update={"test_postgres_db": "other_database"})
    with pytest.raises(ValueError):
        validate_test_database(settings)
