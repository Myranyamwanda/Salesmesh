"""remove local passwords

Revision ID: 0007
Revises: 0006

Firebase now handles passwords, email verification, and password resets, so
the local password hashes, verification tokens, and reset tokens are dropped.
Audit entries are kept.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index(
        op.f("ix_password_reset_tokens_user_id"), table_name="password_reset_tokens"
    )
    op.drop_table("password_reset_tokens")
    op.drop_constraint(
        op.f("uq_users_verification_token_hash"), "users", type_="unique"
    )
    op.drop_column("users", "verification_expires_at")
    op.drop_column("users", "verification_token_hash")
    op.drop_column("users", "password_hash")


def downgrade() -> None:
    # Restores the structure of 0006 only: the dropped password hashes and
    # tokens cannot come back. Use a database backup to restore them.
    op.add_column("users", sa.Column("password_hash", sa.String(length=255)))
    op.add_column("users", sa.Column("verification_token_hash", sa.String(length=64)))
    op.add_column(
        "users", sa.Column("verification_expires_at", sa.DateTime(timezone=True))
    )
    op.create_unique_constraint(
        op.f("uq_users_verification_token_hash"), "users", ["verification_token_hash"]
    )
    op.create_table(
        "password_reset_tokens",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_password_reset_tokens_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_password_reset_tokens")),
        sa.UniqueConstraint(
            "token_hash", name=op.f("uq_password_reset_tokens_token_hash")
        ),
    )
    op.create_index(
        op.f("ix_password_reset_tokens_user_id"),
        "password_reset_tokens",
        ["user_id"],
        unique=False,
    )
