"""Store the catalogue GST rate independently of platform pricing.

Revision ID: p6catalog0016
Revises: o5catalog0015
"""
from alembic import op
import sqlalchemy as sa

revision = "p6catalog0016"
down_revision = "o5catalog0015"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("skus", sa.Column("gst_rate", sa.Float(), nullable=True))
    # Carry forward only unambiguous existing rates. A SKU priced at different
    # rates on different platforms needs human review, not an arbitrary winner.
    op.execute("""UPDATE skus SET gst_rate = (
        SELECT MIN(sp.gst) FROM sku_pricing sp
        WHERE sp.sku_id = skus.id AND sp.company_id = skus.company_id
        HAVING MIN(sp.gst) = MAX(sp.gst)
    ) WHERE EXISTS (
        SELECT 1 FROM sku_pricing sp
        WHERE sp.sku_id = skus.id AND sp.company_id = skus.company_id
    )""")


def downgrade():
    op.drop_column("skus", "gst_rate")
