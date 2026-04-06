"""add_series_to_skus

Revision ID: 70964a6904fb
Revises: b8f3a91c2e54
Create Date: 2026-04-06 04:39:11.291921

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '70964a6904fb'
down_revision: Union[str, None] = 'b8f3a91c2e54'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('skus', sa.Column('series', sa.String(150), nullable=True))


def downgrade() -> None:
    op.drop_column('skus', 'series')
