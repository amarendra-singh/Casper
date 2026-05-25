"""add_sku_platform_config

Revision ID: b8f3a91c2e54
Revises: 69a98e6c92d7
Create Date: 2026-04-05 00:00:00.000000

Already applied directly to DB. Stub to fix migration chain.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b8f3a91c2e54'
down_revision: Union[str, None] = '69a98e6c92d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Already applied: sku_platform_config table + Platform.default_ad_pct/default_profit_pct
    pass


def downgrade() -> None:
    pass
