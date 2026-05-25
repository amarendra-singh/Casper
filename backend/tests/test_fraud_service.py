"""Tests for fraud service pure logic functions."""
import pytest

from app.services.fraud import (
    _risk_tier,
    _trend,
    _classify_alert_severity,
    _settlement_gap_severity,
)


def test_risk_tier_critical_high_z():
    assert _risk_tier(2.1, 0.10) == "CRITICAL"


def test_risk_tier_critical_high_loss():
    assert _risk_tier(0.5, 0.55) == "CRITICAL"


def test_risk_tier_red():
    assert _risk_tier(1.2, 0.20) == "RED"


def test_risk_tier_amber():
    assert _risk_tier(0.6, 0.15) == "AMBER"


def test_risk_tier_green():
    assert _risk_tier(0.1, 0.05) == "GREEN"


def test_trend_worsening():
    assert _trend(0.40, 0.30) == "WORSENING"


def test_trend_improving():
    assert _trend(0.20, 0.32) == "IMPROVING"


def test_trend_stable():
    assert _trend(0.25, 0.27) == "STABLE"


def test_trend_no_prev():
    assert _trend(0.30, None) == "STABLE"


def test_classify_alert_severity_critical():
    assert _classify_alert_severity("SETTLEMENT_GAP", amount=5000) == "CRITICAL"


def test_classify_alert_severity_high():
    assert _classify_alert_severity("COD_ABUSE", amount=None) == "HIGH"


def test_classify_alert_severity_medium():
    assert _classify_alert_severity("RETURN_SPIKE", amount=None) == "MEDIUM"


def test_settlement_gap_severity_large():
    assert _settlement_gap_severity(gap=-8000, pct=-0.12) == "CRITICAL"


def test_settlement_gap_severity_medium():
    assert _settlement_gap_severity(gap=-3000, pct=-0.06) == "HIGH"


def test_settlement_gap_severity_low():
    assert _settlement_gap_severity(gap=-800, pct=-0.02) == "MEDIUM"


def test_settlement_gap_positive_is_none():
    assert _settlement_gap_severity(gap=500, pct=0.02) is None
