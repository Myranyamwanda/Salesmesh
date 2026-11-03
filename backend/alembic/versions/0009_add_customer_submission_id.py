"""add customer submission id

Additive only: a nullable ID, unique when set, that lets a repeated registration
return the first one. Existing customers keep NULL.

Revision ID: 0009
Revises: 0008
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("customers", sa.Column("submission_id", sa.Uuid(), nullable=True))
    op.create_unique_constraint(
        op.f("uq_customers_submission_id"), "customers", ["submission_id"]
    )


def downgrade() -> None:
    op.drop_constraint(op.f("uq_customers_submission_id"), "customers", type_="unique")
    op.drop_column("customers", "submission_id")
