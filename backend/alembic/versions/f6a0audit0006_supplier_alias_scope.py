"""Scope remembered item mappings to registered or named suppliers."""
from alembic import op
import sqlalchemy as sa

revision = 'f6a0audit0006'
down_revision = 'e5f0audit0005'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('vendor_item_aliases', sa.Column('supplier_key', sa.String(180), nullable=True))
    conn = op.get_bind()
    aliases = conn.execute(sa.text('SELECT id,company_id,vendor_id,item_name,sku_id,pack_multiple FROM vendor_item_aliases')).mappings().all()
    for alias in aliases:
        key = f"vendor:{alias['vendor_id']}" if alias['vendor_id'] is not None else None
        if key is None:
            owners = conn.execute(sa.text('''SELECT DISTINCT b.supplier_key
                FROM purchase_bills b JOIN purchase_bill_lines l ON l.bill_id=b.id
                WHERE b.company_id=:company_id AND l.item_name=:item_name
                  AND l.sku_id=:sku_id AND l.pack_multiple=:pack_multiple
                  AND l.match_source IN ('manual','alias')'''), dict(alias)).scalars().all()
            # Only migrate a legacy unscoped mapping when existing evidence
            # identifies exactly one supplier. Ambiguous mappings stay inert.
            key = owners[0] if len(owners) == 1 else f"legacy-unscoped:{alias['id']}"
        duplicate = conn.execute(sa.text('''SELECT id FROM vendor_item_aliases
            WHERE company_id=:company_id AND supplier_key=:key AND item_name=:item_name'''),
            {**dict(alias), 'key': key}).first()
        if duplicate:
            conn.execute(sa.text('UPDATE vendor_item_aliases SET supplier_key=:key WHERE id=:id'),
                         {'key': f'legacy-unscoped:{duplicate[0]}', 'id': duplicate[0]})
            key = f"legacy-unscoped:{alias['id']}"
        conn.execute(sa.text('UPDATE vendor_item_aliases SET supplier_key=:key WHERE id=:id'), {'key': key, 'id': alias['id']})
    with op.batch_alter_table('vendor_item_aliases') as batch:
        batch.alter_column('supplier_key', existing_type=sa.String(180), nullable=False)
        batch.drop_constraint('uq_vendor_item_alias', type_='unique')
        batch.create_unique_constraint('uq_supplier_item_alias', ['company_id', 'supplier_key', 'item_name'])


def downgrade():
    # Named suppliers may legitimately share item wording and a NULL vendor.
    # NULL uniqueness retains those rows on SQLite and PostgreSQL.
    with op.batch_alter_table('vendor_item_aliases') as batch:
        batch.drop_constraint('uq_supplier_item_alias', type_='unique')
        batch.create_unique_constraint('uq_vendor_item_alias', ['company_id', 'vendor_id', 'item_name'])
        batch.drop_column('supplier_key')
