"""model v2 assisted threshold

Model v2 (v1.4.0) withholds three device features in assisted mode instead of
four, so its scores need their own assisted threshold: 0.014058, 5% FPR on
month 5 (ml/train_v2.py, metadata.json "assisted_threshold"). The setting is
changed only if it still holds model v1's value 0.008039, so an administrator's
own choice is kept. No table or column changes; assessments scored by model v1
keep the threshold they were scored with.

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

V1_THRESHOLD = 0.008039
V2_THRESHOLD = 0.014058


def set_threshold(old: float, new: float) -> None:
    op.alter_column("scoring_config", "assisted_threshold", server_default=str(new))
    op.execute(
        sa.text(
            "UPDATE scoring_config SET assisted_threshold = :new "
            "WHERE assisted_threshold = :old"
        ).bindparams(old=old, new=new)
    )


def upgrade() -> None:
    set_threshold(V1_THRESHOLD, V2_THRESHOLD)


def downgrade() -> None:
    set_threshold(V2_THRESHOLD, V1_THRESHOLD)
