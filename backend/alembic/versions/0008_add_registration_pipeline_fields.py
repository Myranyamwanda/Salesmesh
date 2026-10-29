"""add registration pipeline fields

Additive only: customers gain a reference number, the consent version, and the
client recorded at registration; clients gain an organisation name.

Revision ID: 0008
Revises: 0007
"""

import secrets
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Copied rather than imported so this migration never changes if app code does.
ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
REFERENCE_PATTERN = f"^SM-[{ALPHABET}]{{4}}-[{ALPHABET}]{{4}}$"


def new_reference() -> str:
    groups = ("".join(secrets.choice(ALPHABET) for _ in range(4)) for _ in range(2))
    return "SM-" + "-".join(groups)


def upgrade() -> None:
    op.create_table(
        "client_profiles",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("organisation_name", sa.String(length=200), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "length(trim(organisation_name)) > 0",
            name=op.f("ck_client_profiles_organisation_name"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_client_profiles_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_client_profiles")),
    )

    op.add_column("customers", sa.Column("client_id", sa.Uuid(), nullable=True))
    op.add_column(
        "customers", sa.Column("reference", sa.String(length=12), nullable=True)
    )
    # Existing customers agreed to the v1.0-v1.1 wording (SalesMesh only).
    op.add_column(
        "customers",
        sa.Column(
            "consent_version", sa.SmallInteger(), server_default="1", nullable=False
        ),
    )
    op.alter_column("customers", "consent_version", server_default=None)

    # Best available record for existing customers: the agent's current client.
    # Their consent_version is 1, so they are never included in a client export.
    op.execute(
        "UPDATE customers SET client_id = agent_profiles.client_id "
        "FROM agent_profiles WHERE agent_profiles.user_id = customers.agent_id"
    )
    connection = op.get_bind()
    ids = connection.execute(sa.text("SELECT id FROM customers")).scalars().all()
    used = set()
    for customer_id in ids:
        reference = new_reference()
        while reference in used:
            reference = new_reference()
        used.add(reference)
        connection.execute(
            sa.text("UPDATE customers SET reference = :reference WHERE id = :id"),
            {"reference": reference, "id": customer_id},
        )
    op.alter_column("customers", "reference", nullable=False)

    op.create_index(
        op.f("ix_customers_client_id"), "customers", ["client_id"], unique=False
    )
    op.create_unique_constraint(
        op.f("uq_customers_reference"), "customers", ["reference"]
    )
    op.create_foreign_key(
        op.f("fk_customers_client_id_users"),
        "customers",
        "users",
        ["client_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_check_constraint(
        op.f("ck_customers_reference_format"),
        "customers",
        f"reference ~ '{REFERENCE_PATTERN}'",
    )
    op.create_check_constraint(
        op.f("ck_customers_consent_version"), "customers", "consent_version >= 1"
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_customers_consent_version"), "customers", type_="check")
    op.drop_constraint(
        op.f("ck_customers_reference_format"), "customers", type_="check"
    )
    op.drop_constraint(
        op.f("fk_customers_client_id_users"), "customers", type_="foreignkey"
    )
    op.drop_constraint(op.f("uq_customers_reference"), "customers", type_="unique")
    op.drop_index(op.f("ix_customers_client_id"), table_name="customers")
    op.drop_column("customers", "consent_version")
    op.drop_column("customers", "reference")
    op.drop_column("customers", "client_id")
    op.drop_table("client_profiles")
