"""catch up migration chain with the create_all drift

Revision ID: a1c0ffee0001
Revises: 24b02cfe4bdd
Create Date: 2026-10-02

The multi-tenancy, ledger, billing and purchase schema was never migrated. It
was applied straight to the database by four ad-hoc scripts
(scripts/bootstrap_db.py, create_billing_tables.py, create_ledger_table.py,
setup_multicompany.py), so  on an empty database produced
a schema nine tables and twenty-three columns behind the running one.

This revision replays exactly that drift, so a fresh database reaches the state
the live one is already in. It adds no improvements on purpose — the integrity
work (NOT NULL, per-company unique keys, the dead token_blacklist table) is the
next revision, which both a fresh and the live database run normally.

The live database is stamped at this revision rather than running it, because
it already contains every object below.
"""
from alembic import op
import sqlalchemy as sa

revision = 'a1c0ffee0001'
down_revision = '24b02cfe4bdd'
branch_labels = None
depends_on = None

# Every table that gained a tenant key out-of-band. Nullable here because that
# is how the scripts left it; the next revision tightens it to NOT NULL.
TENANT_TABLES = [
    'actor_risk_profiles', 'categories', 'fraud_alerts', 'global_settings',
    'hsn_codes', 'misc_items', 'order_events', 'platform_tiers', 'platforms',
    'pnl_reports', 'pnl_sku_rows', 'return_reason_clusters',
    'sku_platform_config', 'sku_pricing', 'sku_risk_scores', 'skus',
    'state_risk_profiles', 'vendors',
]

SNAP_COLS = [
    'snap_cogs_per_unit', 'snap_fulfillment_per_unit', 'snap_return_per_unit',
    'snap_overhead_per_unit', 'snap_breakeven', 'snap_gst',
]


def upgrade():
    op.create_table('companies',
    sa.Column('id', sa.INTEGER(), nullable=False),
    sa.Column('name', sa.VARCHAR(length=150), nullable=False),
    sa.Column('slug', sa.VARCHAR(length=160), nullable=False),
    sa.Column('color', sa.VARCHAR(length=20), nullable=False),
    sa.Column('owner_id', sa.INTEGER(), nullable=False),
    sa.Column('is_active', sa.BOOLEAN(), nullable=False),
    sa.Column('created_at', sa.DATETIME(), nullable=False),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_companies_owner_id', 'companies', ['owner_id'], unique=False)
    op.create_index('ix_companies_slug', 'companies', ['slug'], unique=1)
    op.create_table('company_memberships',
    sa.Column('id', sa.INTEGER(), nullable=False),
    sa.Column('company_id', sa.INTEGER(), nullable=False),
    sa.Column('user_id', sa.INTEGER(), nullable=False),
    sa.Column('role', sa.VARCHAR(length=6), nullable=False),
    sa.Column('created_at', sa.DATETIME(), nullable=False),
    sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('company_id', 'user_id', name='uq_company_user')
    )
    op.create_index('ix_company_memberships_company_id', 'company_memberships', ['company_id'], unique=False)
    op.create_index('ix_company_memberships_user_id', 'company_memberships', ['user_id'], unique=False)
    op.create_table('company_modules',
    sa.Column('id', sa.INTEGER(), nullable=False),
    sa.Column('company_id', sa.INTEGER(), nullable=False),
    sa.Column('module_key', sa.VARCHAR(length=40), nullable=False),
    sa.Column('enabled', sa.BOOLEAN(), nullable=False),
    sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('company_id', 'module_key', name='uq_company_module')
    )
    op.create_index('ix_company_modules_company_id', 'company_modules', ['company_id'], unique=False)
    op.create_table('invoices',
    sa.Column('id', sa.INTEGER(), nullable=False),
    sa.Column('company_id', sa.INTEGER(), nullable=True),
    sa.Column('number', sa.VARCHAR(length=40), nullable=False),
    sa.Column('invoice_date', sa.DATE(), nullable=False),
    sa.Column('due_date', sa.DATE(), nullable=True),
    sa.Column('customer_name', sa.VARCHAR(length=150), nullable=False),
    sa.Column('customer_gstin', sa.VARCHAR(length=20), nullable=True),
    sa.Column('status', sa.VARCHAR(length=12), nullable=False),
    sa.Column('gst_pct', sa.FLOAT(), nullable=False),
    sa.Column('subtotal', sa.FLOAT(), nullable=False),
    sa.Column('tax_amount', sa.FLOAT(), nullable=False),
    sa.Column('total', sa.FLOAT(), nullable=False),
    sa.Column('amount_paid', sa.FLOAT(), nullable=False),
    sa.Column('bank_name', sa.VARCHAR(length=100), nullable=True),
    sa.Column('notes', sa.TEXT(), nullable=True),
    sa.Column('created_by', sa.INTEGER(), nullable=True),
    sa.Column('created_at', sa.DATETIME(), nullable=False),
    sa.Column('updated_at', sa.DATETIME(), nullable=False),
    sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_invoices_company_id', 'invoices', ['company_id'], unique=False)
    op.create_index('ix_invoices_invoice_date', 'invoices', ['invoice_date'], unique=False)
    op.create_table('invoice_lines',
    sa.Column('id', sa.INTEGER(), nullable=False),
    sa.Column('invoice_id', sa.INTEGER(), nullable=False),
    sa.Column('description', sa.VARCHAR(length=255), nullable=False),
    sa.Column('sku_id', sa.INTEGER(), nullable=True),
    sa.Column('quantity', sa.FLOAT(), nullable=False),
    sa.Column('unit_price', sa.FLOAT(), nullable=False),
    sa.Column('amount', sa.FLOAT(), nullable=False),
    sa.ForeignKeyConstraint(['invoice_id'], ['invoices.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['sku_id'], ['skus.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('ledger_entries',
    sa.Column('id', sa.INTEGER(), nullable=False),
    sa.Column('company_id', sa.INTEGER(), nullable=True),
    sa.Column('entry_date', sa.DATE(), nullable=False),
    sa.Column('direction', sa.VARCHAR(length=10), nullable=False),
    sa.Column('category', sa.VARCHAR(length=40), nullable=False),
    sa.Column('amount', sa.FLOAT(), nullable=False),
    sa.Column('vendor_id', sa.INTEGER(), nullable=True),
    sa.Column('party_name', sa.VARCHAR(length=150), nullable=True),
    sa.Column('sku_id', sa.INTEGER(), nullable=True),
    sa.Column('bank_name', sa.VARCHAR(length=100), nullable=True),
    sa.Column('payment_method', sa.VARCHAR(length=20), nullable=True),
    sa.Column('reference_no', sa.VARCHAR(length=100), nullable=True),
    sa.Column('note', sa.TEXT(), nullable=True),
    sa.Column('created_by', sa.INTEGER(), nullable=True),
    sa.Column('created_at', sa.DATETIME(), nullable=False),
    sa.Column('updated_at', sa.DATETIME(), nullable=False),
    sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['sku_id'], ['skus.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['vendor_id'], ['vendors.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_ledger_entries_company_id', 'ledger_entries', ['company_id'], unique=False)
    op.create_index('ix_ledger_entries_entry_date', 'ledger_entries', ['entry_date'], unique=False)
    op.create_table('vendor_item_aliases',
    sa.Column('id', sa.INTEGER(), nullable=False),
    sa.Column('company_id', sa.INTEGER(), nullable=False),
    sa.Column('vendor_id', sa.INTEGER(), nullable=True),
    sa.Column('item_name', sa.VARCHAR(length=300), nullable=False),
    sa.Column('sku_id', sa.INTEGER(), nullable=False),
    sa.Column('pack_multiple', sa.FLOAT(), nullable=False),
    sa.Column('created_at', sa.DATETIME(), nullable=False),
    sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ),
    sa.ForeignKeyConstraint(['sku_id'], ['skus.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['vendor_id'], ['vendors.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('company_id', 'vendor_id', 'item_name', name='uq_vendor_item_alias')
    )
    op.create_index('ix_vendor_item_aliases_company_id', 'vendor_item_aliases', ['company_id'], unique=False)
    op.create_table('purchase_bills',
    sa.Column('id', sa.INTEGER(), nullable=False),
    sa.Column('company_id', sa.INTEGER(), nullable=False),
    sa.Column('vendor_id', sa.INTEGER(), nullable=True),
    sa.Column('party_name', sa.VARCHAR(length=150), nullable=True),
    sa.Column('ref_no', sa.VARCHAR(length=60), nullable=False),
    sa.Column('bill_date', sa.DATE(), nullable=False),
    sa.Column('txn_type', sa.VARCHAR(length=20), nullable=False),
    sa.Column('status', sa.VARCHAR(length=10), nullable=False),
    sa.Column('total', sa.FLOAT(), nullable=False),
    sa.Column('lines_total', sa.FLOAT(), nullable=False),
    sa.Column('source', sa.VARCHAR(length=20), nullable=False),
    sa.Column('source_file', sa.VARCHAR(length=255), nullable=True),
    sa.Column('notes', sa.TEXT(), nullable=True),
    sa.Column('created_at', sa.DATETIME(), nullable=False),
    sa.Column('updated_at', sa.DATETIME(), nullable=False),
    sa.Column('ledger_entry_id', sa.INTEGER(), nullable=True),
    sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ),
    sa.ForeignKeyConstraint(['ledger_entry_id'], ['ledger_entries.id'], ),
    sa.ForeignKeyConstraint(['vendor_id'], ['vendors.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('company_id', 'vendor_id', 'ref_no', name='uq_purchase_bill_ref')
    )
    op.create_index('ix_purchase_bills_bill_date', 'purchase_bills', ['bill_date'], unique=False)
    op.create_index('ix_purchase_bills_company_date', 'purchase_bills', ['company_id', 'bill_date'], unique=False)
    op.create_index('ix_purchase_bills_company_id', 'purchase_bills', ['company_id'], unique=False)
    op.create_table('purchase_bill_lines',
    sa.Column('id', sa.INTEGER(), nullable=False),
    sa.Column('bill_id', sa.INTEGER(), nullable=False),
    sa.Column('line_no', sa.INTEGER(), nullable=False),
    sa.Column('item_name', sa.VARCHAR(length=300), nullable=False),
    sa.Column('hsn_code', sa.VARCHAR(length=20), nullable=True),
    sa.Column('quantity', sa.FLOAT(), nullable=True),
    sa.Column('unit', sa.VARCHAR(length=20), nullable=True),
    sa.Column('price_unit', sa.FLOAT(), nullable=True),
    sa.Column('amount', sa.FLOAT(), nullable=True),
    sa.Column('sku_id', sa.INTEGER(), nullable=True),
    sa.Column('match_source', sa.VARCHAR(length=12), nullable=False),
    sa.Column('pack_multiple', sa.FLOAT(), nullable=False),
    sa.ForeignKeyConstraint(['bill_id'], ['purchase_bills.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['sku_id'], ['skus.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_purchase_bill_lines_bill_id', 'purchase_bill_lines', ['bill_id'], unique=False)
    op.create_index('ix_purchase_bill_lines_sku', 'purchase_bill_lines', ['sku_id'], unique=False)

    for table in TENANT_TABLES:
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column('company_id', sa.Integer(), nullable=True))
            batch.create_foreign_key(f'fk_{table}_company', 'companies', ['company_id'], ['id'])

    with op.batch_alter_table('pnl_sku_rows') as batch:
        for col in SNAP_COLS:
            batch.add_column(sa.Column(col, sa.Float(), nullable=True))

    # platforms.name was globally unique. With one seller that was invisible;
    # with eight it stops the second company from having a "Flipkart".
    op.drop_index('ix_platforms_name', table_name='platforms')
    op.create_index('ix_platforms_name', 'platforms', ['name'], unique=False)


def downgrade():
    op.drop_index('ix_platforms_name', table_name='platforms')
    op.create_index('ix_platforms_name', 'platforms', ['name'], unique=True)

    with op.batch_alter_table('pnl_sku_rows') as batch:
        for col in SNAP_COLS:
            batch.drop_column(col)

    for table in TENANT_TABLES:
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(f'fk_{table}_company', type_='foreignkey')
            batch.drop_column('company_id')

    for table in ['purchase_bill_lines', 'purchase_bills', 'vendor_item_aliases',
                  'invoice_lines', 'invoices', 'ledger_entries',
                  'company_modules', 'company_memberships', 'companies']:
        op.drop_table(table)
