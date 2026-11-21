"""scope actor_risk_profiles.actor_key to the owning company

Revision ID: c3b0a7e10003
Revises: b2d0face0002
Create Date: 2026-10-02

The fifth and last globally-unique key on a tenant table, missed in the
previous revision and caught by the inverse guard in
tests/test_schema_migrations.py.

An actor_key is a hash of a buyer identity. UNIQUE(actor_key) across the whole
table meant that once one company recorded a risk profile for a buyer, no other
company could record its own for that same buyer — the insert was simply
rejected. Risk scoring is per seller, so the key is per company.

SQLite declares this one inline as `UNIQUE (actor_key)` in the table body
rather than as a named index, so it cannot be dropped by name. The batch block
below rebuilds the table from an explicit definition that omits it.
"""
from alembic import op
import sqlalchemy as sa

revision = 'c3b0a7e10003'
down_revision = 'b2d0face0002'
branch_labels = None
depends_on = None


def _table(*extra_constraints) -> sa.Table:
    """
    The table as it stands, described explicitly.

    batch_alter_table rebuilds from this definition, so the inline UNIQUE has to
    be named here to be droppable — sqlite stores it unnamed in the table body
    and reflection gives nothing to drop by name.
    """
    return sa.Table(
        'actor_risk_profiles', sa.MetaData(),
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('actor_key', sa.String(64), nullable=False),
        sa.Column('state_name', sa.String(100)),
        sa.Column('dominant_reason', sa.String(255)),
        sa.Column('fraud_signal_type', sa.String(50)),
        sa.Column('total_orders', sa.Integer(), nullable=False),
        sa.Column('return_count', sa.Integer(), nullable=False),
        sa.Column('fraud_reason_count', sa.Integer(), nullable=False),
        sa.Column('avg_velocity_days', sa.Float()),
        sa.Column('actor_fraud_score', sa.Float()),
        sa.Column('risk_tier', sa.String(20), nullable=False),
        sa.Column('computed_at', sa.DateTime()),
        sa.Column('company_id', sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['company_id'], ['companies.id'],
                                name='fk_actor_risk_profiles_company_id'),
        # Declared here too: batch rebuilds the table, and any index not part of
        # this definition is lost in the rebuild.
        sa.Index('ix_actor_risk_profiles_company_id', 'company_id'),
        *extra_constraints,
    )


GLOBAL_UQ = sa.UniqueConstraint('actor_key', name='uq_actor_key_global')
SCOPED_UQ = sa.UniqueConstraint('company_id', 'actor_key', name='uq_actor_company_key')


def upgrade():
    with op.batch_alter_table('actor_risk_profiles', copy_from=_table(GLOBAL_UQ)) as batch:
        batch.drop_constraint('uq_actor_key_global', type_='unique')
        batch.create_unique_constraint('uq_actor_company_key', ['company_id', 'actor_key'])
    op.create_index('ix_actor_risk_profiles_actor_key', 'actor_risk_profiles',
                    ['actor_key'], unique=False)


def downgrade():
    op.drop_index('ix_actor_risk_profiles_actor_key', table_name='actor_risk_profiles')
    with op.batch_alter_table('actor_risk_profiles', copy_from=_table(SCOPED_UQ)) as batch:
        batch.drop_constraint('uq_actor_company_key', type_='unique')
        batch.create_unique_constraint('uq_actor_key_global', ['actor_key'])
