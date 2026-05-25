"""add_fixed_fee_to_pnl_sku_rows

Revision ID: b7d959691938
Revises: d1e2f3a4b5c6
Create Date: 2026-04-16 22:43:53.014149

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b7d959691938'
down_revision: Union[str, None] = 'd1e2f3a4b5c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('pnl_sku_rows', sa.Column('fixed_fee', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('pnl_sku_rows', 'fixed_fee')
