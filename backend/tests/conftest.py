from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from alembic import command
from app.core.config import get_settings


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
