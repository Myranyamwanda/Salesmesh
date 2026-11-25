"""model v2 assisted threshold and audit share

Model v2 (v1.4.0) withholds three device features in assisted mode instead of
four, so its scores need their own assisted threshold: 0.014058, 5% FPR on
month 5 (ml/train_v2.py, metadata.json "assisted_threshold"). Its flags find
less assisted fraud than model v1's, so the random audit share rises from 10%
to 20% (ml/assisted_v2.py, docs/model-card.md). Each setting is changed only if
it still holds its v1.3.0 value, so an administrator's own choice is kept. No
table or column changes; assessments scored by model v1 keep the threshold they
were scored with.

Revision ID: 0011
Revises: 0010
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# column: (v1.3.0 value, v1.4.0 value)
CHANGES = {
    "assisted_threshold": (0.008039, 0.014058),
    "audit_share": (0.1, 0.2),
}


def set_value(column: str, old: float, new: float) -> None:
    op.alter_column("scoring_config", column, server_default=str(new))
    op.execute(
        sa.text(
            f"UPDATE scoring_config SET {column} = :new WHERE {column} = :old"
        ).bindparams(old=old, new=new)
    )


def upgrade() -> None:
    for column, (old, new) in CHANGES.items():
        set_value(column, old, new)


def downgrade() -> None:
    for column, (old, new) in CHANGES.items():
        set_value(column, new, old)
