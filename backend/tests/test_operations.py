"""Unit tests for operations reports pure function."""
from app.services.operations import build_operations


def _units(gross=100, rto=10, rvp=8, cancelled=5, net=77):
    return dict(gross=gross, rto=rto, rvp=rvp, cancelled=cancelled, net=net)


def _fees(gross_sales=100000.0, commission=12000.0, marketing=4000.0, courier=6000.0,
          collection=1000.0, tcs=1500.0, total_expenses=-30000.0, bank_settlement=70000.0):
    return dict(gross_sales=gross_sales, commission=commission, marketing=marketing,
                courier=courier, collection=collection, tcs=tcs,
                total_expenses=total_expenses, bank_settlement=bank_settlement)


# ── Empty ────────────────────────────────────────────────────────────────────────

def test_empty():
    out = build_operations({}, {}, [], [])
    assert out["summary"]["dispatched"] == 0
    assert out["funnel"][0]["value"] == 0
    assert out["return_reasons"] == []
    assert out["returns_by_channel"] == []


# ── Funnel ───────────────────────────────────────────────────────────────────────

def test_funnel_pct_of_dispatched():
    out = build_operations(_units(), _fees(), [], [])
    funnel = {f["label"]: f for f in out["funnel"]}
    assert funnel["Dispatched"]["value"] == 100
    assert funnel["Dispatched"]["pct"] == 100.0
    assert funnel["RTO (logistics)"]["pct"] == 10.0
    assert funnel["Net delivered"]["value"] == 77
    assert out["summary"]["rto_rate"] == 10.0
    assert out["summary"]["return_rate"] == 8.0


def test_funnel_zero_dispatched_no_div_zero():
    out = build_operations(_units(gross=0, rto=0, rvp=0, cancelled=0, net=0), {}, [], [])
    assert all(f["pct"] == 0.0 for f in out["funnel"])


# ── Fees waterfall ───────────────────────────────────────────────────────────────

def test_fees_other_bucket_balances_to_total_expenses():
    # known = 12000+4000+6000+1000+1500 = 24500; total_exp = 30000 → Other = 5500
    out = build_operations(_units(), _fees(), [], [])
    labels = {w["label"]: w["value"] for w in out["fees"]}
    assert labels["Gross sales (GMV)"] == 100000.0
    assert labels["Other fees"] == 5500.0
    assert labels["Net settlement"] == 70000.0


def test_fees_skips_zero_components():
    out = build_operations(_units(), _fees(marketing=0.0, courier=0.0, collection=0.0,
                                          tcs=0.0, commission=0.0, total_expenses=0.0), [], [])
    labels = [w["label"] for w in out["fees"]]
    assert "Ads & marketing" not in labels
    assert "Other fees" not in labels
    assert labels[0] == "Gross sales (GMV)"
    assert labels[-1] == "Net settlement"


# ── Return reasons ───────────────────────────────────────────────────────────────

def test_return_reasons_cleaned_sorted_and_capped():
    reasons = [
        {"reason": "order_cancelled", "count": 200},
        {"reason": "QUALITY_ISSUE", "count": 80},
        {"reason": "SIZE_FIT_ISSUES", "count": 60},
        {"reason": "DAMAGED_PRODUCT", "count": 30},
        {"reason": "CUSTOMER_REMORSE", "count": 20},
        {"reason": "misship", "count": 10},
        {"reason": "shield_cancellation", "count": 5},
    ]
    out = build_operations(_units(), _fees(), reasons, [])
    rr = out["return_reasons"]
    assert rr[0]["reason"] == "Order Cancelled"  # title-cased, highest
    assert len(rr) == 6                            # capped at REASON_LIMIT
    assert rr[-1]["reason"] == "Other"             # tail rolled up
    assert sum(r["pct"] for r in rr) == 100.0 or abs(sum(r["pct"] for r in rr) - 100.0) < 1.0
    assert all(r["color"].startswith("#") for r in rr)


def test_return_reasons_ignore_zero_counts():
    out = build_operations(_units(), _fees(), [{"reason": "x", "count": 0}], [])
    assert out["return_reasons"] == []


# ── Returns by channel ───────────────────────────────────────────────────────────

def test_returns_by_channel_sorted_and_filters_empty():
    channels = [
        {"platform": "Flipkart", "rvp": 66, "rto": 93},
        {"platform": "Meesho", "rvp": 26, "rto": 14},
        {"platform": "Snapdeal", "rvp": 0, "rto": 0},
    ]
    out = build_operations(_units(), _fees(), [], channels)
    bc = out["returns_by_channel"]
    assert [c["platform"] for c in bc] == ["Flipkart", "Meesho"]  # Snapdeal dropped, sorted
    assert bc[0]["total"] == 159
