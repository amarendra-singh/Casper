"""Unit tests for settlement reconciliation pure function."""
import pytest
from app.services.reconciliation import build_reconciliation


def _rep(platform, gross=100000.0, bs=80000.0, settled=60000.0, pending=20000.0, fees=15000.0):
    return dict(platform=platform, gross_sales=gross, bank_settlement=bs,
                amount_settled=settled, amount_pending=pending, fees=fees)


def _watch(sku, platform="Flipkart", expected_pu=200.0, actual_total=1800.0, net_units=10):
    return dict(sku=sku, platform=platform, expected_bs_per_unit=expected_pu,
                actual_bs_total=actual_total, net_units=net_units)


# ── Empty ───────────────────────────────────────────────────────────────────────

def test_empty():
    out = build_reconciliation([], [])
    assert out["summary"]["pending"] == 0.0
    assert out["summary"]["settled_pct"] is None
    assert out["platforms"] == []
    assert out["underpaid"] == []


# ── Cash position aggregation ────────────────────────────────────────────────────

def test_cash_position():
    out = build_reconciliation([_rep("Flipkart"), _rep("Meesho")], [])
    sm = out["summary"]
    assert sm["bank_settlement"] == 160000.0
    assert sm["settled"] == 120000.0
    assert sm["pending"] == 40000.0
    assert sm["settled_pct"] == 75.0          # 120000 / 160000


# ── Fee load flag ────────────────────────────────────────────────────────────────

def test_fee_load_flagged_when_high():
    # fees 30000 / gross 100000 = 30% > 25% flag threshold
    out = build_reconciliation([_rep("Flipkart", gross=100000.0, fees=30000.0)], [])
    p = out["platforms"][0]
    assert p["fee_load_pct"] == 30.0
    assert p["fee_flag"] is True


def test_fee_load_not_flagged_when_normal():
    out = build_reconciliation([_rep("Meesho", gross=100000.0, fees=15000.0)], [])
    assert out["platforms"][0]["fee_flag"] is False


def test_negative_fees_treated_as_magnitude():
    # FK stores expenses negative; fee-load must still be positive 30%
    out = build_reconciliation([_rep("Flipkart", gross=100000.0, fees=-30000.0)], [])
    p = out["platforms"][0]
    assert p["fee_load_pct"] == 30.0
    assert p["fee_flag"] is True


# ── Underpayment detection ───────────────────────────────────────────────────────

def test_underpayment_detected():
    # expected 200/unit, actual 1800/10 = 180/unit → gap -20/unit × 10 = -200
    out = build_reconciliation([], [_watch("UP", expected_pu=200.0, actual_total=1800.0, net_units=10)])
    assert out["summary"]["underpaid_skus"] == 1
    assert out["summary"]["recoverable"] == 200.0     # positive magnitude
    u = out["underpaid"][0]
    assert u["gap_per_unit"] == -20.0
    assert u["gap_total"] == -200.0


def test_no_underpayment_when_paid_in_full():
    # actual 2000/10 = 200/unit == expected → no gap
    out = build_reconciliation([], [_watch("OK", expected_pu=200.0, actual_total=2000.0, net_units=10)])
    assert out["summary"]["underpaid_skus"] == 0
    assert out["underpaid"] == []


def test_overpayment_not_flagged():
    # actual 2200/10 = 220 > expected 200 → positive gap, not recoverable
    out = build_reconciliation([], [_watch("OVER", expected_pu=200.0, actual_total=2200.0, net_units=10)])
    assert out["summary"]["underpaid_skus"] == 0


def test_tiny_gap_below_threshold_ignored():
    # gap -0.5/unit < UNDERPAY_MIN_RS (1.0) → ignored as noise
    out = build_reconciliation([], [_watch("TINY", expected_pu=200.0, actual_total=1995.0, net_units=10)])
    assert out["summary"]["underpaid_skus"] == 0


# ── Underpaid sorted most-negative first ─────────────────────────────────────────

def test_underpaid_sorted():
    rows = [
        _watch("SMALL", expected_pu=200.0, actual_total=1900.0, net_units=10),  # -100
        _watch("BIG",   expected_pu=200.0, actual_total=1500.0, net_units=10),  # -500
    ]
    out = build_reconciliation([], rows)
    assert out["underpaid"][0]["sku"] == "BIG"
    assert out["underpaid"][1]["sku"] == "SMALL"
