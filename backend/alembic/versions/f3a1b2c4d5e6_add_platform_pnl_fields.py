"""add platform-specific fields to pnl_reports (Snapdeal + Meesho)

Revision ID: f3a1b2c4d5e6
Revises: 531ad60e2325
Create Date: 2026-05-14

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f3a1b2c4d5e6'
down_revision: Union[str, None] = '531ad60e2325'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('pnl_reports', schema=None) as batch_op:
        batch_op.add_column(sa.Column('seller_name', sa.String(255), nullable=True))
        batch_op.add_column(sa.Column('seller_code', sa.String(100), nullable=True))
        batch_op.add_column(sa.Column('gross_orders', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('return_orders', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('net_orders', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('cod_orders', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('ncod_orders', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('marketing_fee', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('courier_fee', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('payment_collection_fee', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('commission_total', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('tcs_amount', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('tds_amount', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('opening_balance', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('closing_balance', sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('pnl_reports', schema=None) as batch_op:
        for col in [
            'seller_name', 'seller_code', 'gross_orders', 'return_orders',
            'net_orders', 'cod_orders', 'ncod_orders', 'marketing_fee',
            'courier_fee', 'payment_collection_fee', 'commission_total',
            'tcs_amount', 'tds_amount', 'opening_balance', 'closing_balance',
        ]:
            batch_op.drop_column(col)
