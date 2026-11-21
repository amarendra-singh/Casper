"""Product profiles, media, shared stock movements and approved costs."""
from alembic import op
import sqlalchemy as sa

revision = "j0a0catalog0010"
down_revision = "i9a0audit0009"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("stock_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("base_unit", sa.String(30), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("company_id", "name", name="uq_stock_item_company_name"))
    op.create_index("ix_stock_items_company_id", "stock_items", ["company_id"])
    with op.batch_alter_table("skus") as batch:
        batch.add_column(sa.Column("display_name", sa.String(200)))
        batch.add_column(sa.Column("stock_item_id", sa.Integer(), sa.ForeignKey("stock_items.id", ondelete="RESTRICT", name="fk_skus_stock_item_id")))
        batch.add_column(sa.Column("base_units_per_sku", sa.Integer()))

    op.create_table("sku_images",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id"), nullable=False),
        sa.Column("sku_id", sa.Integer(), sa.ForeignKey("skus.id", ondelete="CASCADE"), nullable=False),
        sa.Column("file_name", sa.String(80), nullable=False),
        sa.Column("mime_type", sa.String(30), nullable=False),
        sa.Column("is_primary", sa.Boolean(), nullable=False),
        sa.Column("alt_text", sa.String(200)),
        sa.Column("uploaded_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False))
    op.create_index("ix_sku_images_company_id", "sku_images", ["company_id"])
    op.create_index("ix_sku_images_sku_id", "sku_images", ["sku_id"])
    op.create_index("uq_sku_primary_image", "sku_images", ["company_id", "sku_id"], unique=True,
                    sqlite_where=sa.text("is_primary = 1"), postgresql_where=sa.text("is_primary = true"))

    op.create_table("stock_movements",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id"), nullable=False),
        sa.Column("stock_item_id", sa.Integer(), sa.ForeignKey("stock_items.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("sku_id", sa.Integer(), sa.ForeignKey("skus.id", ondelete="RESTRICT")),
        sa.Column("movement_date", sa.Date(), nullable=False),
        sa.Column("movement_type", sa.String(24), nullable=False),
        sa.Column("base_units_delta", sa.Integer(), nullable=False),
        sa.Column("request_key", sa.String(80), nullable=False),
        sa.Column("reverses_id", sa.Integer(), sa.ForeignKey("stock_movements.id", ondelete="RESTRICT")),
        sa.Column("reference_type", sa.String(30)),
        sa.Column("reference_id", sa.Integer()),
        sa.Column("reason", sa.Text()),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("company_id", "request_key", name="uq_stock_movement_request"),
        sa.UniqueConstraint("company_id", "reverses_id", name="uq_stock_movement_reversal"))
    op.create_index("ix_stock_movements_company_id", "stock_movements", ["company_id"])
    op.create_index("ix_stock_movement_item_date", "stock_movements", ["stock_item_id", "movement_date"])

    op.create_table("stock_costs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id"), nullable=False),
        sa.Column("stock_item_id", sa.Integer(), sa.ForeignKey("stock_items.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("cost_per_base_unit", sa.Float(), nullable=False),
        sa.Column("source_type", sa.String(20), nullable=False),
        sa.Column("source_id", sa.Integer()),
        sa.Column("effective_date", sa.Date(), nullable=False),
        sa.Column("note", sa.String(300)),
        sa.Column("approved_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("company_id", "source_type", "source_id", name="uq_stock_cost_source"))
    op.create_index("ix_stock_costs_company_id", "stock_costs", ["company_id"])


def downgrade():
    op.drop_table("stock_costs")
    op.drop_table("stock_movements")
    op.drop_table("sku_images")
    with op.batch_alter_table("skus") as batch:
        batch.drop_column("base_units_per_sku")
        batch.drop_column("stock_item_id")
        batch.drop_column("display_name")
    op.drop_table("stock_items")
