"""Store reverse shipping on SKU/platform before pricing exists.

Revision ID: o5catalog0015
Revises: n4revship0014
"""
from alembic import op
import sqlalchemy as sa

revision = "o5catalog0015"
down_revision = "n4revship0014"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("sku_reverse_shipping",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id"), nullable=False),
        sa.Column("sku_id", sa.Integer(), sa.ForeignKey("skus.id", ondelete="CASCADE"), nullable=False),
        sa.Column("platform_id", sa.Integer(), sa.ForeignKey("platforms.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("charge", sa.Float(), nullable=False),
        sa.UniqueConstraint("company_id", "sku_id", "platform_id", name="uq_sku_reverse_shipping_scope"),
    )
    op.create_index("ix_sku_reverse_shipping_company_id", "sku_reverse_shipping", ["company_id"])
    op.execute("""INSERT INTO sku_reverse_shipping (company_id, sku_id, platform_id, charge)
        SELECT pc.company_id, sp.sku_id, pc.platform_id, pc.reverse_shipping_charge
        FROM sku_platform_config pc JOIN sku_pricing sp ON sp.id = pc.sku_pricing_id
        WHERE pc.reverse_shipping_charge IS NOT NULL
          AND sp.company_id = pc.company_id
          AND pc.id = (SELECT MAX(newest.id) FROM sku_platform_config newest
              JOIN sku_pricing owner ON owner.id = newest.sku_pricing_id
              WHERE newest.company_id = pc.company_id AND owner.sku_id = sp.sku_id
                AND newest.platform_id = pc.platform_id
                AND newest.reverse_shipping_charge IS NOT NULL)""")


def downgrade():
    op.drop_index("ix_sku_reverse_shipping_company_id", table_name="sku_reverse_shipping")
    op.drop_table("sku_reverse_shipping")
