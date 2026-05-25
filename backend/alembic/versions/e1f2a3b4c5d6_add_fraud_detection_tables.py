"""add_fraud_detection_tables

Revision ID: e1f2a3b4c5d6
Revises: b7d959691938
Create Date: 2026-05-23

order_events   — one row per order extracted from any platform P&L upload
sku_risk_scores — computed intelligence (Z-score based) per SKU per platform
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'e1f2a3b4c5d6'
down_revision: Union[str, None] = 'f3a1b2c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'order_events',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('report_id', sa.Integer(), nullable=False),
        sa.Column('platform_id', sa.Integer(), nullable=False),
        sa.Column('sku_pricing_id', sa.Integer(), nullable=True),
        sa.Column('external_order_id', sa.String(255), nullable=True),
        sa.Column('sku_platform_name', sa.String(255), nullable=False),
        sa.Column('order_date', sa.Date(), nullable=True),
        sa.Column('order_status', sa.String(50), nullable=False),
        sa.Column('payment_mode', sa.String(50), nullable=True),
        sa.Column('sale_amount', sa.Float(), nullable=True),
        sa.Column('settled_amount', sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(['platform_id'], ['platforms.id']),
        sa.ForeignKeyConstraint(['report_id'], ['pnl_reports.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['sku_pricing_id'], ['sku_pricing.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_order_events_platform_id', 'order_events', ['platform_id'])
    op.create_index('ix_order_events_report_id', 'order_events', ['report_id'])
    op.create_index('ix_order_events_order_date', 'order_events', ['order_date'])
    op.create_index('ix_order_events_sku', 'order_events', ['sku_platform_name'])

    op.create_table(
        'sku_risk_scores',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('sku_pricing_id', sa.Integer(), nullable=True),
        sa.Column('platform_id', sa.Integer(), nullable=False),
        sa.Column('sku_platform_name', sa.String(255), nullable=False),
        sa.Column('computed_at', sa.DateTime(), nullable=True),
        sa.Column('gross_orders', sa.Integer(), nullable=True),
        sa.Column('delivered_orders', sa.Integer(), nullable=True),
        sa.Column('returned_orders', sa.Integer(), nullable=True),
        sa.Column('rto_orders', sa.Integer(), nullable=True),
        sa.Column('cancelled_orders', sa.Integer(), nullable=True),
        sa.Column('pending_return_orders', sa.Integer(), nullable=True),
        sa.Column('in_transit_orders', sa.Integer(), nullable=True),
        sa.Column('return_rate', sa.Float(), nullable=True),
        sa.Column('rto_rate', sa.Float(), nullable=True),
        sa.Column('cancellation_rate', sa.Float(), nullable=True),
        sa.Column('combined_loss_rate', sa.Float(), nullable=True),
        sa.Column('platform_avg_return_rate', sa.Float(), nullable=True),
        sa.Column('platform_std_return_rate', sa.Float(), nullable=True),
        sa.Column('z_score', sa.Float(), nullable=True),
        sa.Column('risk_tier', sa.String(20), nullable=True),
        sa.Column('prepaid_return_rate', sa.Float(), nullable=True),
        sa.Column('postpaid_return_rate', sa.Float(), nullable=True),
        sa.Column('cod_abuse_flag', sa.Boolean(), nullable=True),
        sa.Column('avg_sale_amount', sa.Float(), nullable=True),
        sa.Column('total_revenue', sa.Float(), nullable=True),
        sa.Column('revenue_at_risk', sa.Float(), nullable=True),
        sa.Column('trend_direction', sa.String(20), nullable=True),
        sa.ForeignKeyConstraint(['platform_id'], ['platforms.id']),
        sa.ForeignKeyConstraint(['sku_pricing_id'], ['sku_pricing.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_sku_risk_platform', 'sku_risk_scores', ['platform_id'])
    op.create_index('ix_sku_risk_tier', 'sku_risk_scores', ['risk_tier'])


def downgrade() -> None:
    op.drop_table('sku_risk_scores')
    op.drop_table('order_events')
