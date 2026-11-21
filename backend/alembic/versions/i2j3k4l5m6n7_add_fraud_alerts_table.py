"""add fraud_alerts table

Revision ID: i2j3k4l5m6n7
Revises: h1i2j3k4l5m6
Create Date: 2025-01-01 00:00:00.000000

Reconstructed: the original file was deleted from the repo while the database
stayed stamped past it, which broke `alembic current` outright. Rebuilt from the
compiled module and verified column-for-column against the live schema.
"""
from alembic import op
import sqlalchemy as sa

revision = 'i2j3k4l5m6n7'
down_revision = 'h1i2j3k4l5m6'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'fraud_alerts',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('platform_id', sa.Integer(), sa.ForeignKey('platforms.id'), nullable=False),
        sa.Column('report_id', sa.Integer(), nullable=True),
        sa.Column('alert_type', sa.String(50), nullable=False),
        sa.Column('severity', sa.String(20), nullable=False),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('evidence_json', sa.Text(), nullable=True),
        sa.Column('sku_platform_name', sa.String(255), nullable=True),
        sa.Column('amount', sa.Float(), nullable=True),
        sa.Column('is_resolved', sa.Boolean(), nullable=False, default=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
    )


def downgrade():
    op.drop_table('fraud_alerts')
