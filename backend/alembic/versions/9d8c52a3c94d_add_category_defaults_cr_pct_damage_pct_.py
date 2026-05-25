"""add category defaults: cr_pct, damage_pct, profit_pct

Revision ID: 9d8c52a3c94d
Revises: d4a7b2f81055
Create Date: 2026-05-09 00:13:50.091936

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9d8c52a3c94d'
down_revision: Union[str, None] = 'd4a7b2f81055'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Phase 4 — Category defaults cascade.
    Adds three nullable percentage fields to `categories` so new SKUs in a
    category can auto-fill CR%, Damage%, Profit% from the category default.
    Per-SKU override remains allowed.
    """
    op.add_column('categories', sa.Column('default_cr_pct',     sa.Float(), nullable=True))
    op.add_column('categories', sa.Column('default_damage_pct', sa.Float(), nullable=True))
    op.add_column('categories', sa.Column('default_profit_pct', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('categories', 'default_profit_pct')
    op.drop_column('categories', 'default_damage_pct')
    op.drop_column('categories', 'default_cr_pct')
