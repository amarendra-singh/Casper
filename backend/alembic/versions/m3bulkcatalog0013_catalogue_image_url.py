"""Allow a catalogue product to reference a public primary image URL.

Revision ID: m3bulkcatalog0013
Revises: l2b0edits0012
"""
from alembic import op
import sqlalchemy as sa

revision = "m3bulkcatalog0013"
down_revision = "l2b0edits0012"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("skus", sa.Column("primary_image_url", sa.String(length=2048), nullable=True))


def downgrade():
    op.drop_column("skus", "primary_image_url")
