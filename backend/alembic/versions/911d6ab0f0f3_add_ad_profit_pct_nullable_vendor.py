"""add_ad_profit_pct_nullable_vendor

Revision ID: 911d6ab0f0f3
Revises: 69a98e6c92d7
Create Date: 2026-04-01 02:10:12.785419

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '911d6ab0f0f3'
down_revision: Union[str, None] = '69a98e6c92d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add new columns to sku_pricing (skip if already added by a partial previous run)
    conn = op.get_bind()
    existing = [row[1] for row in conn.execute(sa.text("PRAGMA table_info(sku_pricing)")).fetchall()]
    with op.batch_alter_table('sku_pricing') as batch_op:
        if 'ad' not in existing:
            batch_op.add_column(sa.Column('ad', sa.Float(), nullable=False, server_default='0'))
        if 'profit_percentage' not in existing:
            batch_op.add_column(sa.Column('profit_percentage', sa.Float(), nullable=False, server_default='20'))

    # SQLite doesn't support ALTER COLUMN — use batch_alter_table to make nullable
    with op.batch_alter_table('skus') as batch_op:
        batch_op.alter_column('vendor_sku',  existing_type=sa.VARCHAR(length=150), nullable=True)
        batch_op.alter_column('vendor_id',   existing_type=sa.INTEGER(),           nullable=True)
        batch_op.alter_column('category_id', existing_type=sa.INTEGER(),           nullable=True)


def downgrade() -> None:
    with op.batch_alter_table('skus') as batch_op:
        batch_op.alter_column('category_id', existing_type=sa.INTEGER(),           nullable=False)
        batch_op.alter_column('vendor_id',   existing_type=sa.INTEGER(),           nullable=False)
        batch_op.alter_column('vendor_sku',  existing_type=sa.VARCHAR(length=150), nullable=False)

    with op.batch_alter_table('sku_pricing') as batch_op:
        batch_op.drop_column('profit_percentage')
        batch_op.drop_column('ad')
