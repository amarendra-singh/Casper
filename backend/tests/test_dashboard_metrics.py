"""Unit tests for dashboard metrics ribbon builder."""
import pytest
from app.routes.dashboard import _build_metrics_cells


def _cells(**kwargs):
    """Call with only the args you care about; defaults fill the rest."""
    defaults = dict(
        gross_u=0, net_u=0,
        sku_gross=0, rvp_u=0, rto_u=0,
        settle=0.0, gross_s=0.0, avg_margin=0.0,
        fraud_cnt=0, total_ord=0,
        crit_count=0, crit_vel=None, top_score=None,
    )
    defaults.update(kwargs)
    return _build_metrics_cells(**defaults)


# ── Sell-through (a01) ────────────────────────────────────────────────────────

def test_sell_through_computed():
    cells = _cells(gross_u=78, net_u=54)
    a01 = next(c for c in cells if c["idx"] == "a01")
    assert a01["val"] == "69.2"
    assert a01["unit"] == "%"
    assert a01["meter"] == 69


def test_sell_through_no_data():
    cells = _cells(gross_u=0, net_u=0)
    a01 = next(c for c in cells if c["idx"] == "a01")
    assert a01["val"] == "—"
    assert a01["unit"] == ""
    assert a01["meter"] == 0


# ── Customer return (a02) ─────────────────────────────────────────────────────

def test_customer_return_computed():
    cells = _cells(sku_gross=78, rvp_u=24)
    a02 = next(c for c in cells if c["idx"] == "a02")
    assert a02["val"] == "30.8"
    assert a02["unit"] == "%"
    assert a02["trend_cls"] == "down"   # > 20% is bad


def test_customer_return_low_is_good():
    cells = _cells(sku_gross=100, rvp_u=5)
    a02 = next(c for c in cells if c["idx"] == "a02")
    assert a02["trend_cls"] == "up"


def test_customer_return_no_data():
    cells = _cells(sku_gross=0, rvp_u=0)
    a02 = next(c for c in cells if c["idx"] == "a02")
    assert a02["val"] == "—"
    assert a02["unit"] == ""


# ── RTO rate (a09) ────────────────────────────────────────────────────────────

def test_rto_computed():
    cells = _cells(sku_gross=630, rto_u=50)
    a09 = next(c for c in cells if c["idx"] == "a09")
    assert a09["val"] == "7.9"
    assert a09["unit"] == "%"
    assert a09["trend_cls"] == "up"    # < 10% is acceptable


def test_rto_high_is_bad():
    cells = _cells(sku_gross=100, rto_u=15)
    a09 = next(c for c in cells if c["idx"] == "a09")
    assert a09["trend_cls"] == "down"  # > 10% is bad


def test_rto_no_data():
    cells = _cells(sku_gross=0, rto_u=0)
    a09 = next(c for c in cells if c["idx"] == "a09")
    assert a09["val"] == "—"
    assert a09["unit"] == ""


# ── Fraud signal rate (a03) ───────────────────────────────────────────────────

def test_fraud_rate_computed():
    cells = _cells(fraud_cnt=40, total_ord=582)
    a03 = next(c for c in cells if c["idx"] == "a03")
    assert a03["val"] == "6.9"
    assert a03["trend_cls"] == "down"   # > 5% is bad


def test_fraud_rate_no_data():
    cells = _cells(fraud_cnt=0, total_ord=0)
    a03 = next(c for c in cells if c["idx"] == "a03")
    assert a03["val"] == "—"


# ── Settlement rate (a04) ─────────────────────────────────────────────────────

def test_settlement_rate_computed():
    cells = _cells(settle=20000.0, gross_s=50000.0)
    a04 = next(c for c in cells if c["idx"] == "a04")
    assert a04["val"] == "40.0"
    assert a04["unit"] == "%"


def test_settlement_rate_no_data():
    cells = _cells(settle=0.0, gross_s=0.0)
    a04 = next(c for c in cells if c["idx"] == "a04")
    assert a04["val"] == "—"


# ── Avg net margin (a05) ──────────────────────────────────────────────────────

def test_avg_margin_computed():
    cells = _cells(avg_margin=51.9)
    a05 = next(c for c in cells if c["idx"] == "a05")
    assert a05["val"] == "51.9"
    assert a05["trend_cls"] == "up"     # > 30% is good


def test_avg_margin_zero():
    cells = _cells(avg_margin=0.0)
    a05 = next(c for c in cells if c["idx"] == "a05")
    assert a05["val"] == "—"


# ── CRITICAL actors (a06) ─────────────────────────────────────────────────────

def test_critical_actors_shown():
    cells = _cells(crit_count=2)
    a06 = next(c for c in cells if c["idx"] == "a06")
    assert a06["val"] == "2"
    assert a06["trend_cls"] == "down"


def test_critical_actors_zero():
    cells = _cells(crit_count=0)
    a06 = next(c for c in cells if c["idx"] == "a06")
    assert a06["val"] == "—"
    assert a06["trend_cls"] == "up"


# ── Avg fraud velocity (a07) ──────────────────────────────────────────────────

def test_fraud_velocity_computed():
    cells = _cells(crit_vel=1.5)
    a07 = next(c for c in cells if c["idx"] == "a07")
    assert a07["val"] == "1.5"
    assert a07["unit"] == "d"


def test_fraud_velocity_none():
    cells = _cells(crit_vel=None)
    a07 = next(c for c in cells if c["idx"] == "a07")
    assert a07["val"] == "—"
    assert a07["unit"] == ""


def test_fraud_velocity_zero():
    cells = _cells(crit_vel=0.0)
    a07 = next(c for c in cells if c["idx"] == "a07")
    assert a07["val"] == "—"
    assert a07["unit"] == ""


# ── Top fraud score (a08) ─────────────────────────────────────────────────────

def test_top_score_computed():
    cells = _cells(top_score=99.0)
    a08 = next(c for c in cells if c["idx"] == "a08")
    assert a08["val"] == "99"
    assert a08["unit"] == "/100"
    assert a08["trend_cls"] == "down"   # > 80 is bad


def test_top_score_none():
    cells = _cells(top_score=None)
    a08 = next(c for c in cells if c["idx"] == "a08")
    assert a08["val"] == "—"
    assert a08["unit"] == ""


# ── Always returns 9 cells ────────────────────────────────────────────────────

def test_always_9_cells():
    cells = _cells()
    assert len(cells) == 9
    idxs = [c["idx"] for c in cells]
    assert idxs == ["a01", "a02", "a09", "a03", "a04", "a05", "a06", "a07", "a08"]
