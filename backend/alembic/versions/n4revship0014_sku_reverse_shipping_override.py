"""Allow a SKU to override its platform reverse-shipping charge.

Revision ID: n4revship0014
Revises: m3bulkcatalog0013
"""
from alembic import op
import sqlalchemy as sa

revision = "n4revship0014"
down_revision = "m3bulkcatalog0013"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("sku_platform_config", sa.Column("reverse_shipping_charge", sa.Float(), nullable=True))


def downgrade():
    op.drop_column("sku_platform_config", "reverse_shipping_charge")
