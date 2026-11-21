"""add token_blacklist table

Revision ID: 24b02cfe4bdd
Revises: i2j3k4l5m6n7
Create Date: 2025-01-01 00:00:00.000000

Reconstructed: see i2j3k4l5m6n7. This is the revision the database was stamped
at, so with its file missing alembic could not resolve the current head at all.
"""
from alembic import op
import sqlalchemy as sa

revision = '24b02cfe4bdd'
down_revision = 'i2j3k4l5m6n7'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'token_blacklist',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('jti', sa.String(length=64), nullable=False),
        sa.Column('token_type', sa.String(length=16), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_token_blacklist_jti'), 'token_blacklist', ['jti'], unique=True)


def downgrade():
    op.drop_index(op.f('ix_token_blacklist_jti'), table_name='token_blacklist')
    op.drop_table('token_blacklist')
