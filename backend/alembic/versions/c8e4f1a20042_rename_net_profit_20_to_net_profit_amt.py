"""rename net_profit_20 to net_profit_amt

Revision ID: c8e4f1a20042
Revises: b7d959691938
Create Date: 2026-04-17 04:00:00.000000

Rationale: column name was hardcoded to '_20' when profit % was always 20.
Profit is now dynamic per SKU, so the suffix is misleading. Renames to reflect
that the value is the computed profit AMOUNT in rupees (not a fixed rate).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c8e4f1a20042'
down_revision: Union[str, None] = 'b7d959691938'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('sku_pricing') as batch_op:
        batch_op.alter_column('net_profit_20', new_column_name='net_profit_amt')


def downgrade() -> None:
    with op.batch_alter_table('sku_pricing') as batch_op:
        batch_op.alter_column('net_profit_amt', new_column_name='net_profit_20')
