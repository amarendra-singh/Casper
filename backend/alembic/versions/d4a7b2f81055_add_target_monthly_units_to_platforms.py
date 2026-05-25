"""add target_monthly_units to platforms

Revision ID: d4a7b2f81055
Revises: c8e4f1a20042
Create Date: 2026-04-17 12:30:00.000000

Rationale: True P&L needs to compare actual units delivered vs target volume
to detect fixed-cost absorption variance (e.g. misc=Rs12/unit × 700 target
= Rs8,400 monthly overhead budget).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd4a7b2f81055'
down_revision: Union[str, None] = 'c8e4f1a20042'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('platforms') as batch_op:
        batch_op.add_column(
            sa.Column('target_monthly_units', sa.Integer(), nullable=False, server_default='700')
        )
    # Flipkart default = 700 (per user input)
    op.execute("UPDATE platforms SET target_monthly_units = 700 WHERE name = 'Flipkart'")


def downgrade() -> None:
    with op.batch_alter_table('platforms') as batch_op:
        batch_op.drop_column('target_monthly_units')
