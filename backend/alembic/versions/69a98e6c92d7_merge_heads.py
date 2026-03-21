"""merge heads

Revision ID: 69a98e6c92d7
Revises: a413eb320126, fca2ca12d777
Create Date: 2026-03-20 00:31:45.843973

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '69a98e6c92d7'
down_revision: Union[str, None] = ('a413eb320126', 'fca2ca12d777')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
