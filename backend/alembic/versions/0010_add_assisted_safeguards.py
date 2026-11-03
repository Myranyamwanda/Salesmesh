"""add assisted safeguards

Additive only: settings for the assisted threshold, random audits, and the
assisted-share alert, and on each assessment the threshold kind applied and
whether it was picked for a random audit. Existing assessments were scored at
the standard threshold and never audited, which the defaults record.

Revision ID: 0010
Revises: 0009
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CONFIG_CHECKS = {
    "assisted_threshold": "assisted_threshold > 0 AND assisted_threshold < 1",
    "audit_share": "audit_share >= 0 AND audit_share <= 1",
    "assisted_alert_multiple": "assisted_alert_multiple > 1",
}


def upgrade() -> None:
    op.add_column(
        "scoring_config",
        sa.Column(
            "assisted_threshold", sa.Float(), server_default="0.008039", nullable=False
        ),
    )
    op.add_column(
        "scoring_config",
        sa.Column("audit_share", sa.Float(), server_default="0.1", nullable=False),
    )
    op.add_column(
        "scoring_config",
        sa.Column(
            "assisted_alert_multiple", sa.Float(), server_default="2", nullable=False
        ),
    )
    for name, condition in CONFIG_CHECKS.items():
        op.create_check_constraint(
            op.f(f"ck_scoring_config_{name}"), "scoring_config", condition
        )
    op.add_column(
        "risk_assessments",
        sa.Column(
            "threshold_kind",
            sa.String(length=10),
            server_default="standard",
            nullable=False,
        ),
    )
    op.add_column(
        "risk_assessments",
        sa.Column(
            "audit_selected", sa.Boolean(), server_default="false", nullable=False
        ),
    )
    op.create_check_constraint(
        op.f("ck_risk_assessments_threshold_kind"),
        "risk_assessments",
        "threshold_kind IN ('standard', 'assisted')",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("ck_risk_assessments_threshold_kind"), "risk_assessments", type_="check"
    )
    op.drop_column("risk_assessments", "audit_selected")
    op.drop_column("risk_assessments", "threshold_kind")
    for name in CONFIG_CHECKS:
        op.drop_constraint(
            op.f(f"ck_scoring_config_{name}"), "scoring_config", type_="check"
        )
    op.drop_column("scoring_config", "assisted_alert_multiple")
    op.drop_column("scoring_config", "audit_share")
    op.drop_column("scoring_config", "assisted_threshold")
