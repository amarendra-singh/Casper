"""Tests for velocity + composite fraud score logic."""
import pytest
from app.models.fraud import OrderEvent, SkuRiskScore
from app.services.fraud import _compute_velocity_days, _parse_date_col
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


def test_compute_velocity_days_normal():
    """Delivery 2026-04-30, return pickup 2026-05-01 = 1 day."""
    assert _compute_velocity_days(date(2026, 4, 30), date(2026, 5, 1)) == 1


def test_compute_velocity_days_same_day():
    """Same-day return = 0 days."""
    assert _compute_velocity_days(date(2026, 5, 1), date(2026, 5, 1)) == 0


def test_compute_velocity_days_none_delivery():
    """If delivery_date is None, return None."""
    assert _compute_velocity_days(None, date(2026, 5, 1)) is None


def test_compute_velocity_days_none_pickup():
    """If return_pickup_date is None, return None."""
    assert _compute_velocity_days(date(2026, 5, 1), None) is None


def test_compute_velocity_days_return_before_delivery():
    """Return date before delivery is impossible — return None."""
    assert _compute_velocity_days(date(2026, 5, 5), date(2026, 5, 1)) is None


def test_parse_date_col_none():
    """None input → None output."""
    assert _parse_date_col(None) is None


def test_parse_date_col_with_date():
    """A real date object passes through."""
    d = date(2026, 5, 1)
    assert _parse_date_col(d) == d


from app.services.fraud import _composite_fraud_score, _velocity_stats


def test_composite_score_all_clean():
    """Clean SKU: z=0, no velocity fraud, no cod abuse."""
    score = _composite_fraud_score(
        z_score=0.0, velocity_fraud_pct=0.0, cod_abuse=False,
        settlement_gap_pct=0.0, fee_overcharge_pct=0.0,
    )
    assert score == 0.0


def test_composite_score_critical_velocity():
    """50% of returns in <=3 days = velocity component of 25."""
    score = _composite_fraud_score(
        z_score=0.0, velocity_fraud_pct=0.5, cod_abuse=False,
        settlement_gap_pct=0.0, fee_overcharge_pct=0.0,
    )
    assert score == 25.0


def test_composite_score_max_capped_at_100():
    """All signals maxed out = capped at 100."""
    score = _composite_fraud_score(
        z_score=5.0, velocity_fraud_pct=1.0, cod_abuse=True,
        settlement_gap_pct=0.5, fee_overcharge_pct=0.5,
    )
    assert score == 100.0


def test_velocity_stats_normal():
    """2-day and 4-day returns: avg=3.0, fraud_count=1 (only 2-day qualifies <=3)."""
    stats = _velocity_stats([2, 4])
    assert stats["avg_velocity"] == 3.0
    assert stats["velocity_fraud_count"] == 1


def test_velocity_stats_empty():
    """No velocity data -> avg=None, count=0."""
    stats = _velocity_stats([])
    assert stats["avg_velocity"] is None
    assert stats["velocity_fraud_count"] == 0


def test_velocity_stats_all_rapid():
    """All returns in <=3 days -> all count as fraud."""
    stats = _velocity_stats([1, 2, 3])
    assert stats["velocity_fraud_count"] == 3
