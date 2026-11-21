"""tenant integrity: NOT NULL company keys, per-company unique business keys

Revision ID: b2d0face0002
Revises: a1c0ffee0001
Create Date: 2026-10-02

Three classes of defect, all of them live with eight companies in the database.

1. Four UNIQUE indexes were global where the business key is per-company:

     ix_global_settings_key   only ONE company in the whole system could store
                              a damage_percent row. Company 1 held it, so every
                              other tenant silently fell back to the hardcoded
                              15% default and could not save its own value.
     ix_skus_shringar_sku     two sellers could not list the same SKU code.
     ix_vendors_short_code    vendor code "JE" was taken globally.
     ix_categories_name       category "Whisky Glass" was taken globally.

   Each becomes a plain index plus UNIQUE(company_id, <col>).

2. company_id was nullable on nineteen tenant tables, so a row could exist
   belonging to nobody and be invisible to every scoped query. Verified first:
   zero NULLs and zero orphans across all of them.

3. token_blacklist has no model and no code reference anywhere in the backend.
   JWT revocation was never wired up. It holds two refresh tokens that expired
   in June. Dropped rather than left as schema nobody maintains.

Also adds UNIQUE(company_id, sku_id, platform_id) on sku_pricing. Without it a
re-anchored upsert inserts a second cost row for the same SKU and platform and
the grid quietly reads whichever has the higher id.

SQLite cannot ALTER or constrain in place, so everything here runs through
batch_alter_table, which rebuilds each table and copies its rows.
"""
from alembic import op
import sqlalchemy as sa

revision = 'b2d0face0002'
down_revision = 'a1c0ffee0001'
branch_labels = None
depends_on = None

# Reflected foreign keys are unnamed on the live database (inline REFERENCES),
# so a convention is needed before one can be dropped by name.
NC = {"fk": "fk_%(table_name)s_%(column_0_name)s"}

# company_id -> NOT NULL. The flag says whether this table still needs its
# ix_<table>_company_id; the tables created in the previous revision already
# got theirs from create_table.
TENANT = [
    ('actor_risk_profiles', True), ('categories', True), ('fraud_alerts', True),
    ('global_settings', True), ('invoices', False), ('ledger_entries', False),
    ('misc_items', True), ('order_events', True), ('platform_tiers', True),
    ('platforms', True), ('pnl_reports', True), ('pnl_sku_rows', True),
    ('return_reason_clusters', True), ('sku_platform_config', True),
    ('sku_pricing', True), ('sku_risk_scores', True), ('skus', True),
    ('state_risk_profiles', True), ('vendors', True),
]

# A global UNIQUE index that should have been scoped:
# (table, column, index name, replacement constraint name)
GLOBAL_UNIQUES = [
    ('categories', 'name', 'ix_categories_name', 'uq_category_company_name'),
    ('global_settings', 'key', 'ix_global_settings_key', 'uq_setting_company_key'),
    ('skus', 'shringar_sku', 'ix_skus_shringar_sku', 'uq_sku_company_code'),
    ('vendors', 'short_code', 'ix_vendors_short_code', 'uq_vendor_company_code'),
]

# Business keys that were never constrained at all.
NEW_UNIQUES = [
    ('misc_items', 'uq_misc_company_name', ['company_id', 'name']),
    ('platforms', 'uq_platform_company_name', ['company_id', 'name']),
    ('vendors', 'uq_vendor_company_name', ['company_id', 'name']),
    ('sku_pricing', 'uq_pricing_company_sku_platform',
     ['company_id', 'sku_id', 'platform_id']),
]

# Columns the models declare NOT NULL but the database left nullable.
NOT_NULL = [
    ('fraud_alerts', 'created_at', sa.DATETIME()),
    ('pnl_reports', 'uploaded_at', sa.DATETIME()),
    ('pnl_reports', 'status', sa.VARCHAR(length=20)),
    ('sku_platform_config', 'created_at', sa.DATETIME()),
    ('sku_platform_config', 'updated_at', sa.DATETIME()),
    ('sku_risk_scores', 'computed_at', sa.DATETIME()),
    ('sku_risk_scores', 'gross_orders', sa.INTEGER()),
    ('sku_risk_scores', 'delivered_orders', sa.INTEGER()),
    ('sku_risk_scores', 'returned_orders', sa.INTEGER()),
    ('sku_risk_scores', 'rto_orders', sa.INTEGER()),
    ('sku_risk_scores', 'cancelled_orders', sa.INTEGER()),
    ('sku_risk_scores', 'pending_return_orders', sa.INTEGER()),
    ('sku_risk_scores', 'in_transit_orders', sa.INTEGER()),
    ('sku_risk_scores', 'risk_tier', sa.VARCHAR(length=20)),
    ('sku_risk_scores', 'cod_abuse_flag', sa.BOOLEAN()),
]


def _by_table(rows):
    """[(table, a, b), ...] -> {table: [(a, b), ...]}"""
    out = {}
    for row in rows:
        out.setdefault(row[0], []).append(row[1:])
    return out


def upgrade():
    op.drop_index('ix_token_blacklist_jti', table_name='token_blacklist')
    op.drop_table('token_blacklist')

    # HSN codes are national GST codes shared by every tenant, and the model has
    # no company_id. The column was added by the create_all scripts and holds
    # nothing: the table is empty.
    with op.batch_alter_table('hsn_codes', naming_convention=NC) as batch:
        batch.drop_column('company_id')

    nn = _by_table(NOT_NULL)
    uq = _by_table(GLOBAL_UNIQUES)
    new_uq = _by_table(NEW_UNIQUES)

    for table, needs_index in TENANT:
        # One batch per table: each block rebuilds the table and copies every
        # row, so all of a table's changes belong in the same block.
        with op.batch_alter_table(table, naming_convention=NC) as batch:
            batch.alter_column('company_id', existing_type=sa.INTEGER(), nullable=False)
            for col, type_ in nn.pop(table, []):
                batch.alter_column(col, existing_type=type_, nullable=False)
            for name, cols in new_uq.pop(table, []):
                batch.create_unique_constraint(name, cols)
            for col, ix, cons in uq.get(table, []):
                batch.create_unique_constraint(cons, ['company_id', col])
        if needs_index:
            op.create_index(f'ix_{table}_company_id', table, ['company_id'], unique=False)

    # Swap each global unique index for a plain one. Done after the constraint
    # above exists, so the key is never left unprotected.
    for table, col, ix, cons in GLOBAL_UNIQUES:
        op.drop_index(ix, table_name=table)
        op.create_index(ix, table, [col], unique=False)

    assert not nn, f"unapplied NOT NULL columns: {nn}"
    assert not new_uq, f"unapplied unique constraints: {new_uq}"

    # fraud_alerts.report_id pointed at pnl_reports.id with no foreign key at
    # all, so an alert could outlive its report. Deleting a report must take its
    # alerts with it, and without ON DELETE CASCADE that delete now fails
    # outright, because the application enables PRAGMA foreign_keys on every
    # connection.
    with op.batch_alter_table('fraud_alerts', naming_convention=NC) as batch:
        batch.create_foreign_key('fk_fraud_alerts_report_id', 'pnl_reports',
                                 ['report_id'], ['id'], ondelete='CASCADE')

    # A purchase bill outlives the ledger line it posted to.
    with op.batch_alter_table('purchase_bills', naming_convention=NC) as batch:
        batch.drop_constraint('fk_purchase_bills_ledger_entry_id', type_='foreignkey')
        batch.create_foreign_key('fk_purchase_bills_ledger_entry_id', 'ledger_entries',
                                 ['ledger_entry_id'], ['id'], ondelete='SET NULL')


def downgrade():
    for table, col, ix, cons in GLOBAL_UNIQUES:
        op.drop_index(ix, table_name=table)
        op.create_index(ix, table, [col], unique=True)

    nn = _by_table(NOT_NULL)
    uq = _by_table(GLOBAL_UNIQUES)
    new_uq = _by_table(NEW_UNIQUES)

    for table, needs_index in TENANT:
        if needs_index:
            op.drop_index(f'ix_{table}_company_id', table_name=table)
        with op.batch_alter_table(table, naming_convention=NC) as batch:
            for col, ix, cons in uq.get(table, []):
                batch.drop_constraint(cons, type_='unique')
            for name, cols in new_uq.pop(table, []):
                batch.drop_constraint(name, type_='unique')
            for col, type_ in nn.pop(table, []):
                batch.alter_column(col, existing_type=type_, nullable=True)
            batch.alter_column('company_id', existing_type=sa.INTEGER(), nullable=True)

    with op.batch_alter_table('hsn_codes') as batch:
        batch.add_column(sa.Column('company_id', sa.Integer(), nullable=True))

    op.create_table(
        'token_blacklist',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('jti', sa.String(length=64), nullable=False),
        sa.Column('token_type', sa.String(length=16), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_token_blacklist_jti', 'token_blacklist', ['jti'], unique=True)
