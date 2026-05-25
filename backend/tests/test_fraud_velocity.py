"""Tests for velocity + composite fraud score logic."""
import pytest
from app.models.fraud import OrderEvent, SkuRiskScore
from datetime import date


def test_order_event_has_velocity_fields():
    """Model must accept velocity date fields."""
    ev = OrderEvent(
        sku_platform_name="TEST-SKU",
        order_status="RETURNED",
        dispatch_date=None,
        delivery_date=date(2026, 4, 30),
        return_pickup_date=date(2026, 5, 1),
        return_velocity_days=1,
        commission_charged=45.0,
    )
    assert ev.return_velocity_days == 1
    assert ev.commission_charged == 45.0
    assert ev.delivery_date == date(2026, 4, 30)


def test_sku_risk_score_has_composite_fields():
    """SkuRiskScore must have composite_fraud_score and velocity fields."""
    s = SkuRiskScore(
        sku_platform_name="TEST",
        platform_id=1,
        composite_fraud_score=72.5,
        avg_return_velocity_days=2.3,
        velocity_fraud_count=3,
        fee_overcharge_amount=450.0,
    )
    assert s.composite_fraud_score == 72.5
    assert s.velocity_fraud_count == 3
