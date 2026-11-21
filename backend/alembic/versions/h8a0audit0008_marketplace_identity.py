"""Persist marketplace identity independently of pricing."""
from alembic import op
import sqlalchemy as sa
revision = 'h8a0audit0008'
down_revision = 'g7a0audit0007'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('marketplace_sku_aliases',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('company_id', sa.Integer(), sa.ForeignKey('companies.id'), nullable=False),
        sa.Column('platform_id', sa.Integer(), sa.ForeignKey('platforms.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('sku_id', sa.Integer(), sa.ForeignKey('skus.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.UniqueConstraint('company_id', 'platform_id', 'name', name='uq_marketplace_identity'))


def downgrade():
    op.drop_table('marketplace_sku_aliases')
