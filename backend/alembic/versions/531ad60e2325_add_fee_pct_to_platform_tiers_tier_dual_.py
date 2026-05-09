"""add fee_pct to platform_tiers (Tier dual-mode)

Revision ID: 531ad60e2325
Revises: 9d8c52a3c94d
Create Date: 2026-05-09 00:24:46.305829

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '531ad60e2325'
down_revision: Union[str, None] = '9d8c52a3c94d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Phase 5 — Tier dual-mode (% or ₹).
    Adds nullable `fee_pct` to `platform_tiers`. When set, tier fee is
    computed as base × fee_pct/100; otherwise the existing `fee` (₹) is used.
    """
    op.add_column('platform_tiers', sa.Column('fee_pct', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('platform_tiers', 'fee_pct')
