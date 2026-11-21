"""Store explicit company-scoped supplier name aliases."""
from alembic import op
import sqlalchemy as sa

revision = 'g7a0audit0007'
down_revision = 'f6a0audit0006'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('vendor_name_aliases',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('company_id', sa.Integer(), sa.ForeignKey('companies.id'), nullable=False),
        sa.Column('vendor_id', sa.Integer(), sa.ForeignKey('vendors.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(150), nullable=False),
        sa.UniqueConstraint('company_id', 'name', name='uq_vendor_name_alias_company'))


def downgrade():
    op.drop_table('vendor_name_aliases')
