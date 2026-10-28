"""add firebase uid

Revision ID: 0005
Revises: 0004
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("firebase_uid", sa.String(length=128)))
    op.create_unique_constraint(
        op.f("uq_users_firebase_uid"), "users", ["firebase_uid"]
    )
    # Accounts created through Firebase have no local password.
    op.alter_column(
        "users", "password_hash", existing_type=sa.String(length=255), nullable=True
    )


def downgrade() -> None:
    # "!" is not a valid Argon2 hash, so these accounts cannot sign in with a
    # local password after a downgrade; an administrator must reset them.
    op.execute("UPDATE users SET password_hash = '!' WHERE password_hash IS NULL")
    op.alter_column(
        "users", "password_hash", existing_type=sa.String(length=255), nullable=False
    )
    op.drop_constraint(op.f("uq_users_firebase_uid"), "users", type_="unique")
    op.drop_column("users", "firebase_uid")
