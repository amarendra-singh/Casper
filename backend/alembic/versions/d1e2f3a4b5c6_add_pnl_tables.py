"""add_pnl_tables

Revision ID: d1e2f3a4b5c6
Revises: c3f7a8e1d924
Create Date: 2026-04-11 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'd1e2f3a4b5c6'
down_revision: Union[str, None] = 'c3f7a8e1d924'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'pnl_reports',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('platform_id', sa.Integer(), sa.ForeignKey('platforms.id'), nullable=False),
        sa.Column('period_start', sa.Date(), nullable=False),
        sa.Column('period_end', sa.Date(), nullable=False),
        sa.Column('filename', sa.String(255), nullable=False),
        sa.Column('uploaded_by', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('uploaded_at', sa.DateTime(), nullable=True),
        sa.Column('status', sa.String(20), nullable=True),
        sa.Column('gross_sales', sa.Float(), nullable=True),
        sa.Column('gross_units', sa.Integer(), nullable=True),
        sa.Column('returns_amount', sa.Float(), nullable=True),
        sa.Column('returned_units', sa.Integer(), nullable=True),
        sa.Column('net_sales', sa.Float(), nullable=True),
        sa.Column('net_units', sa.Integer(), nullable=True),
        sa.Column('total_expenses', sa.Float(), nullable=True),
        sa.Column('bank_settlement', sa.Float(), nullable=True),
        sa.Column('input_tax_credits', sa.Float(), nullable=True),
        sa.Column('net_earnings', sa.Float(), nullable=True),
        sa.Column('net_margin_pct', sa.Float(), nullable=True),
        sa.Column('amount_settled', sa.Float(), nullable=True),
        sa.Column('amount_pending', sa.Float(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )

    op.create_table(
        'pnl_sku_rows',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('report_id', sa.Integer(), sa.ForeignKey('pnl_reports.id', ondelete='CASCADE'), nullable=False),
        sa.Column('platform_sku_name', sa.String(255), nullable=False),
        sa.Column('sku_pricing_id', sa.Integer(), sa.ForeignKey('sku_pricing.id'), nullable=True),
        sa.Column('gross_units', sa.Integer(), nullable=True),
        sa.Column('rto_units', sa.Integer(), nullable=True),
        sa.Column('rvp_units', sa.Integer(), nullable=True),
        sa.Column('cancelled_units', sa.Integer(), nullable=True),
        sa.Column('net_units', sa.Integer(), nullable=True),
        sa.Column('accounted_net_sales', sa.Float(), nullable=True),
        sa.Column('commission_fee', sa.Float(), nullable=True),
        sa.Column('collection_fee', sa.Float(), nullable=True),
        sa.Column('reverse_shipping_fee', sa.Float(), nullable=True),
        sa.Column('taxes_gst', sa.Float(), nullable=True),
        sa.Column('taxes_tcs', sa.Float(), nullable=True),
        sa.Column('taxes_tds', sa.Float(), nullable=True),
        sa.Column('rewards_benefits', sa.Float(), nullable=True),
        sa.Column('bank_settlement_projected', sa.Float(), nullable=True),
        sa.Column('input_tax_credits', sa.Float(), nullable=True),
        sa.Column('net_earnings', sa.Float(), nullable=True),
        sa.Column('earnings_per_unit', sa.Float(), nullable=True),
        sa.Column('net_margin_pct', sa.Float(), nullable=True),
        sa.Column('amount_settled', sa.Float(), nullable=True),
        sa.Column('amount_pending', sa.Float(), nullable=True),
        sa.Column('casper_expected_bs', sa.Float(), nullable=True),
        sa.Column('casper_expected_profit_pct', sa.Float(), nullable=True),
        sa.Column('variance_bs', sa.Float(), nullable=True),
        sa.Column('variance_margin_pct', sa.Float(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    op.drop_table('pnl_sku_rows')
    op.drop_table('pnl_reports')
