"""per-platform AD and profit

Revision ID: b8f3a91c2e54
Revises: 69a98e6c92d7
Create Date: 2026-04-02 12:00:00.000000

Changes:
  - platforms: add default_ad_pct, default_profit_pct
  - sku_platform_config: new table for per-SKU-per-platform overrides
  - sku_pricing: drop 'ad' column (AD is now per-platform)
"""
from typing import Sequence, Union
from datetime import datetime

from alembic import op
import sqlalchemy as sa


revision: str = 'b8f3a91c2e54'
down_revision: Union[str, None] = '911d6ab0f0f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on:    Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add default_ad_pct and default_profit_pct to platforms
    with op.batch_alter_table('platforms') as batch_op:
        batch_op.add_column(sa.Column('default_ad_pct',     sa.Float(), nullable=False, server_default='0.0'))
        batch_op.add_column(sa.Column('default_profit_pct', sa.Float(), nullable=False, server_default='20.0'))

    # 2. Create sku_platform_config table
    op.create_table(
        'sku_platform_config',
        sa.Column('id',             sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('sku_pricing_id', sa.Integer(), sa.ForeignKey('sku_pricing.id', ondelete='CASCADE'), nullable=False),
        sa.Column('platform_id',    sa.Integer(), sa.ForeignKey('platforms.id',   ondelete='RESTRICT'), nullable=False),
        sa.Column('ad_pct',         sa.Float(), nullable=True),
        sa.Column('profit_pct',     sa.Float(), nullable=True),
        sa.Column('created_at',     sa.DateTime(), nullable=True, default=datetime.utcnow),
        sa.Column('updated_at',     sa.DateTime(), nullable=True, default=datetime.utcnow),
    )

    # 3. Drop the global 'ad' column from sku_pricing
    #    (use batch_alter_table for SQLite compatibility)
    with op.batch_alter_table('sku_pricing') as batch_op:
        batch_op.drop_column('ad')


def downgrade() -> None:
    # Reverse step 3 — add 'ad' column back
    with op.batch_alter_table('sku_pricing') as batch_op:
        batch_op.add_column(sa.Column('ad', sa.Float(), nullable=False, server_default='0.0'))

    # Reverse step 2
    op.drop_table('sku_platform_config')

    # Reverse step 1
    with op.batch_alter_table('platforms') as batch_op:
        batch_op.drop_column('default_ad_pct')
        batch_op.drop_column('default_profit_pct')
