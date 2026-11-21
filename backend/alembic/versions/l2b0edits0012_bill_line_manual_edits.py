"""Track manual supplier bill line edits so imports cannot silently replace them."""
from alembic import op
import sqlalchemy as sa

revision = "l2b0edits0012"
down_revision = "k1b0units0011"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("purchase_bill_lines", sa.Column("edited_at", sa.DateTime(), nullable=True))


def downgrade():
    op.drop_column("purchase_bill_lines", "edited_at")
