"""add actor fraud fields to order_events

Revision ID: h1i2j3k4l5m6
Revises: g5h6i7j8k9l0
Create Date: 2026-05-26 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'h1i2j3k4l5m6'
down_revision = 'g5h6i7j8k9l0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Actor-dimension fields on order_events
    with op.batch_alter_table("order_events", schema=None) as batch_op:
        batch_op.add_column(sa.Column("return_reason",       sa.String(255), nullable=True))
        batch_op.add_column(sa.Column("return_sub_reason",   sa.String(255), nullable=True))
        batch_op.add_column(sa.Column("cancellation_reason", sa.String(255), nullable=True))
        batch_op.add_column(sa.Column("fraud_signal_type",   sa.String(50),  nullable=True))
        batch_op.add_column(sa.Column("customer_state_code", sa.String(10),  nullable=True))
        batch_op.add_column(sa.Column("customer_state_name", sa.String(100), nullable=True))
        batch_op.add_column(sa.Column("is_cod",              sa.Boolean(),   nullable=True))
        # Make report_id nullable (for standalone FK Orders uploads with no P&L context)
        batch_op.alter_column("report_id", nullable=True)

    # Return reason cluster table
    op.create_table(
        "return_reason_clusters",
        sa.Column("id",                sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("platform_id",       sa.Integer(), sa.ForeignKey("platforms.id"), nullable=False),
        sa.Column("return_reason",     sa.String(255), nullable=False),
        sa.Column("return_sub_reason", sa.String(255), nullable=True),
        sa.Column("fraud_signal_type", sa.String(50),  nullable=False),
        sa.Column("order_count",       sa.Integer(),   nullable=False, default=0),
        sa.Column("computed_at",       sa.DateTime(),  nullable=True),
    )

    # State risk profile table
    op.create_table(
        "state_risk_profiles",
        sa.Column("id",           sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("state_code",   sa.String(10),  nullable=False),
        sa.Column("state_name",   sa.String(100), nullable=False),
        sa.Column("total_orders", sa.Integer(),   nullable=False, default=0),
        sa.Column("fraud_orders", sa.Integer(),   nullable=False, default=0),
        sa.Column("fraud_rate",   sa.Float(),     nullable=True),
        sa.Column("avg_velocity", sa.Float(),     nullable=True),
        sa.Column("risk_tier",    sa.String(20),  nullable=False, default="GREEN"),
        sa.Column("z_score",      sa.Float(),     nullable=True),
        sa.Column("computed_at",  sa.DateTime(),  nullable=True),
    )

    # Actor risk profile table
    op.create_table(
        "actor_risk_profiles",
        sa.Column("id",                  sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("actor_key",           sa.String(64),  nullable=False, unique=True),
        sa.Column("state_name",          sa.String(100), nullable=True),
        sa.Column("dominant_reason",     sa.String(255), nullable=True),
        sa.Column("fraud_signal_type",   sa.String(50),  nullable=True),
        sa.Column("total_orders",        sa.Integer(),   nullable=False, default=0),
        sa.Column("return_count",        sa.Integer(),   nullable=False, default=0),
        sa.Column("fraud_reason_count",  sa.Integer(),   nullable=False, default=0),
        sa.Column("avg_velocity_days",   sa.Float(),     nullable=True),
        sa.Column("actor_fraud_score",   sa.Float(),     nullable=True),
        sa.Column("risk_tier",           sa.String(20),  nullable=False, default="GREEN"),
        sa.Column("computed_at",         sa.DateTime(),  nullable=True),
    )


def downgrade() -> None:
    op.drop_table("actor_risk_profiles")
    op.drop_table("state_risk_profiles")
    op.drop_table("return_reason_clusters")

    with op.batch_alter_table("order_events", schema=None) as batch_op:
        for col in ["return_reason", "return_sub_reason", "cancellation_reason",
                    "fraud_signal_type", "customer_state_code", "customer_state_name", "is_cod"]:
            batch_op.drop_column(col)
        batch_op.alter_column("report_id", nullable=False)
