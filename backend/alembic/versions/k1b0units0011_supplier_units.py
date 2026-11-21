"""Explicit supplier unit conversion; existing unknown values remain null."""
from alembic import op
import sqlalchemy as sa
revision = "k1b0units0011"
down_revision = "j0a0catalog0010"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("purchase_bill_lines", sa.Column("pieces_per_unit", sa.Integer(), nullable=True))

def downgrade():
    op.drop_column("purchase_bill_lines", "pieces_per_unit")
