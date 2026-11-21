"""Financial change history and repeatable standalone order ingestion."""

from alembic import op
import sqlalchemy as sa

revision = "e5f0audit0005"
down_revision = "d4e0audit0004"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "order_events", sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.true())
    )
    # Preserve every old observation. The newest inserted observation is the
    # current status for a standalone order/SKU, matching future upsert behavior.
    op.get_bind().execute(
        sa.text("""UPDATE order_events SET is_current = false
        WHERE report_id IS NULL AND external_order_id IS NOT NULL AND id NOT IN
        (SELECT MAX(id) FROM order_events WHERE report_id IS NULL AND external_order_id IS NOT NULL
         GROUP BY company_id, platform_id, external_order_id, sku_platform_name)""")
    )
    op.add_column("pnl_reports", sa.Column("processing_warnings", sa.JSON(), nullable=True))
    op.create_index(
        "uq_standalone_order_identity",
        "order_events",
        ["company_id", "platform_id", "external_order_id", "sku_platform_name"],
        unique=True,
        sqlite_where=sa.text("report_id IS NULL AND external_order_id IS NOT NULL AND is_current = true"),
        postgresql_where=sa.text("report_id IS NULL AND external_order_id IS NOT NULL AND is_current = true"),
    )
    op.create_table(
        "financial_changes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("actor_id", sa.Integer(), nullable=True),
        sa.Column("entity_type", sa.String(80), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=True),
        sa.Column("action", sa.String(20), nullable=False),
        sa.Column("before", sa.JSON(), nullable=True),
        sa.Column("after", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_financial_changes_company_id", "financial_changes", ["company_id"])


def downgrade():
    op.drop_column("pnl_reports", "processing_warnings")
    op.drop_table("financial_changes")
    op.drop_index("uq_standalone_order_identity", table_name="order_events")
    op.drop_column("order_events", "is_current")
