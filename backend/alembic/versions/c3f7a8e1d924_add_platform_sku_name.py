"""add_platform_sku_name

Revision ID: c3f7a8e1d924
Revises: 70964a6904fb
Create Date: 2026-04-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3f7a8e1d924'
down_revision: Union[str, None] = '70964a6904fb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('sku_platform_config',
        sa.Column('platform_sku_name', sa.String(250), nullable=True))


def downgrade() -> None:
    op.drop_column('sku_platform_config', 'platform_sku_name')
