"""add velocity fields to order_events

Revision ID: g5h6i7j8k9l0
Revises: 4d0665a3fa38
Create Date: 2026-05-25 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'g5h6i7j8k9l0'
down_revision = '4d0665a3fa38'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("order_events", schema=None) as batch_op:
        batch_op.add_column(sa.Column("dispatch_date",      sa.Date(),  nullable=True))
        batch_op.add_column(sa.Column("delivery_date",      sa.Date(),  nullable=True))
        batch_op.add_column(sa.Column("return_pickup_date", sa.Date(),  nullable=True))
        batch_op.add_column(sa.Column("return_velocity_days", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("commission_charged", sa.Float(), nullable=True))

    with op.batch_alter_table("sku_risk_scores", schema=None) as batch_op:
        batch_op.add_column(sa.Column("avg_return_velocity_days", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("velocity_fraud_count",     sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("composite_fraud_score",    sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("fee_overcharge_amount",    sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("order_events", schema=None) as batch_op:
        for col in ["dispatch_date","delivery_date","return_pickup_date","return_velocity_days","commission_charged"]:
            batch_op.drop_column(col)

    with op.batch_alter_table("sku_risk_scores", schema=None) as batch_op:
        for col in ["avg_return_velocity_days","velocity_fraud_count","composite_fraud_score","fee_overcharge_amount"]:
            batch_op.drop_column(col)
