"""Session revocation, pricing override intent, supplier identity and invoice allocation."""

from alembic import op
import sqlalchemy as sa

revision = "d4e0audit0004"
down_revision = "c3b0a7e10003"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    duplicates = bind.execute(
        sa.text("SELECT company_id, number FROM invoices GROUP BY company_id, number HAVING COUNT(*) > 1")
    ).first()
    if duplicates:
        raise RuntimeError(
            "Duplicate invoice numbers require review before this migration; no records were changed"
        )
    op.add_column("users", sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"))
    for field in ("cr_cost", "damage_cost", "misc_total"):
        op.add_column("sku_pricing", sa.Column(field + "_override", sa.Float(), nullable=True))
        # Preserve legacy explicit amounts; operators can switch them to Automatic.
        bind.execute(sa.text(f"UPDATE sku_pricing SET {field}_override = {field}"))
    op.add_column("purchase_bills", sa.Column("supplier_key", sa.String(180), nullable=True))
    rows = bind.execute(sa.text("SELECT id, vendor_id, party_name FROM purchase_bills")).all()
    for row in rows:
        key = (
            f"vendor:{row.vendor_id}"
            if row.vendor_id is not None
            else "party:" + " ".join((row.party_name or "").strip().upper().split())
        )
        if key == "party:":
            # Unknown historical bills stay distinct; new uploads require a supplier.
            key = f"legacy:{row.id}"
        bind.execute(
            sa.text("UPDATE purchase_bills SET supplier_key=:key WHERE id=:id"), {"key": key, "id": row.id}
        )
    with op.batch_alter_table("purchase_bills") as batch:
        batch.alter_column("supplier_key", existing_type=sa.String(180), nullable=False)
        batch.drop_constraint("uq_purchase_bill_ref", type_="unique")
        batch.create_unique_constraint(
            "uq_purchase_bill_supplier_ref", ["company_id", "supplier_key", "ref_no"]
        )
    with op.batch_alter_table("invoices") as batch:
        batch.create_unique_constraint("uq_invoice_company_number", ["company_id", "number"])
    op.create_table(
        "invoice_sequences",
        sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id"), primary_key=True),
        sa.Column("year", sa.Integer(), primary_key=True),
        sa.Column("last_number", sa.Integer(), nullable=False),
    )
    op.create_table(
        "token_blacklist",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("jti", sa.String(64), nullable=False),
        sa.Column("token_type", sa.String(16), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_token_blacklist_jti", "token_blacklist", ["jti"], unique=True)


def downgrade():
    op.drop_table("token_blacklist")
    op.drop_table("invoice_sequences")
    with op.batch_alter_table("invoices") as batch:
        batch.drop_constraint("uq_invoice_company_number", type_="unique")
    with op.batch_alter_table("purchase_bills") as batch:
        batch.drop_constraint("uq_purchase_bill_supplier_ref", type_="unique")
        batch.create_unique_constraint("uq_purchase_bill_ref", ["company_id", "vendor_id", "ref_no"])
        batch.drop_column("supplier_key")
    for field in ("cr_cost", "damage_cost", "misc_total"):
        op.drop_column("sku_pricing", field + "_override")
    op.drop_column("users", "token_version")
