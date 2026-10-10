from sqlalchemy import create_engine, pool

from alembic import context
from app import models
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.base import Base

config = context.config
target_metadata = Base.metadata
configure_logging(get_settings().log_level)
assert models.User.__table__.metadata is target_metadata


def run_migrations_offline() -> None:
    context.configure(
        url=get_settings().database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_with_connection(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connection = config.attributes.get("connection")
    if connection is not None:
        run_with_connection(connection)
        return
    settings = get_settings()
    engine = create_engine(
        settings.database_url,
        poolclass=pool.NullPool,
        connect_args={"connect_timeout": settings.db_connect_timeout},
        hide_parameters=True,
    )
    try:
        with engine.connect() as connection:
            run_with_connection(connection)
    finally:
        engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
