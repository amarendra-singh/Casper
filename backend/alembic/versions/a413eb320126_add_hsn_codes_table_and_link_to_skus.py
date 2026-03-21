from alembic import op
import sqlalchemy as sa

revision = 'a413eb320126'
down_revision = None  # ← keep whatever value was already there
branch_labels = None
depends_on = None

def upgrade():
    # Create hsn_codes table
    op.create_table(
        'hsn_codes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('code', sa.String(20), nullable=False),
        sa.Column('description', sa.String(255), nullable=False),
        sa.Column('gst_rate', sa.Float(), nullable=False),
        sa.Column('category', sa.String(100), nullable=True),
        sa.Column('is_custom', sa.Boolean(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_hsn_codes_code', 'hsn_codes', ['code'], unique=True)

    # Add hsn_code_id to skus using batch mode (required for SQLite)
    with op.batch_alter_table('skus') as batch_op:
        batch_op.add_column(sa.Column('hsn_code_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            'fk_skus_hsn_code_id',
            'hsn_codes',
            ['hsn_code_id'],
            ['id']
        )

def downgrade():
    with op.batch_alter_table('skus') as batch_op:
        batch_op.drop_constraint('fk_skus_hsn_code_id', type_='foreignkey')
        batch_op.drop_column('hsn_code_id')
    op.drop_index('ix_hsn_codes_code', table_name='hsn_codes')
    op.drop_table('hsn_codes')