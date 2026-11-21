"""Invoice receipts with linked ledger posting and reversal."""
from alembic import op
import sqlalchemy as sa
revision = 'i9a0audit0009'
down_revision = 'h8a0audit0008'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('invoice_receipts',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('company_id', sa.Integer(), sa.ForeignKey('companies.id'), nullable=False),
        sa.Column('invoice_id', sa.Integer(), sa.ForeignKey('invoices.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('ledger_entry_id', sa.Integer(), sa.ForeignKey('ledger_entries.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('reversal_entry_id', sa.Integer(), sa.ForeignKey('ledger_entries.id', ondelete='RESTRICT')),
        sa.Column('receipt_date', sa.Date(), nullable=False),
        sa.Column('amount', sa.Float(), nullable=False),
        sa.Column('request_key', sa.String(80), nullable=False),
        sa.Column('payment_method', sa.String(20), nullable=False),
        sa.Column('reference_no', sa.String(100)),
        sa.UniqueConstraint('company_id', 'request_key', name='uq_receipt_request'))


def downgrade():
    op.drop_table('invoice_receipts')
