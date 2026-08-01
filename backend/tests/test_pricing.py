"""
Unit tests for the core pricing formula (services/pricing.py::calculate_pricing).

These pin the master formula chain documented in memory/logic.md §3 — treat it
as a contract. This is the calculation that sets every SKU's break-even floor
and target receivable, so drift here silently mis-prices the whole catalogue.

Formula chain (return-on-COST world):
    breakeven       = price + package + logistics + addons + misc + cr_cost + damage_cost
    net_profit_amt  = breakeven × profit%
    bs_wo_gst       = round(breakeven + net_profit_amt)        # nearest whole rupee
    gst_amount      = round(bs_wo_gst × gst%, 2)
    bank_settlement = round(bs_wo_gst + gst_amount, 2)
"""
from app.services.pricing import calculate_pricing


# ── The canonical worked example from logic.md §3 ─────────────────────────────
def test_spec_worked_example():
    # Price=63, Package=7, Inbound=10, Addons=6, Misc=12,
    # CR%=20% × cr_charge 168 = 33.60 ; Dmg%=8% × price 63 = 5.04 ; Profit%=20% ; GST=5%
    r = calculate_pricing(
        price=63, package=7, logistics=10, addons=6, misc_total=12,
        cr_cost=168 * 0.20, damage_cost=63 * 0.08, gst=5, profit_percentage=20,
    )
    assert r["breakeven"] == 136.64          # 98 landed + 33.60 CR + 5.04 dmg
    assert r["net_profit_amt"] == 27.33      # 136.64 × 20%
    assert r["bs_wo_gst"] == 164.0           # round(136.64 + 27.33) → whole rupee
    assert r["bank_settlement"] == 172.20    # 164 + round(164×5%, 2)=8.20 (precise GST)


# ── Break-even is the pure sum of every cost component ────────────────────────
def test_breakeven_is_sum_of_components():
    r = calculate_pricing(price=100, package=5, logistics=8, addons=2, misc_total=10,
                          cr_cost=20, damage_cost=15, gst=0, profit_percentage=0)
    assert r["breakeven"] == 160.0           # 100+5+8+2+10+20+15
    assert r["net_profit_amt"] == 0.0        # profit 0
    assert r["bs_wo_gst"] == 160.0           # no profit, no rounding change
    assert r["bank_settlement"] == 160.0     # gst 0


# ── Zero GST: bank_settlement equals pre-GST settlement ───────────────────────
def test_zero_gst_passthrough():
    r = calculate_pricing(price=50, package=0, logistics=0, addons=0, misc_total=0,
                          cr_cost=0, damage_cost=0, gst=0, profit_percentage=20)
    assert r["breakeven"] == 50.0
    assert r["net_profit_amt"] == 10.0       # 50 × 20%
    assert r["bs_wo_gst"] == 60.0
    assert r["bank_settlement"] == 60.0       # gst 0 → equal


# ── Profit is anchored on no-GST break-even (GST is pass-through) ──────────────
def test_profit_anchored_on_pre_gst_breakeven():
    # profit must be breakeven×% regardless of GST rate
    low_gst  = calculate_pricing(100, 0, 0, 0, 0, 0, 0, gst=0,  profit_percentage=25)
    high_gst = calculate_pricing(100, 0, 0, 0, 0, 0, 0, gst=18, profit_percentage=25)
    assert low_gst["net_profit_amt"] == high_gst["net_profit_amt"] == 25.0


# ── GST applies to the (rounded) pre-GST settlement, to 2 dp ──────────────────
def test_gst_applied_to_rounded_pre_gst():
    r = calculate_pricing(price=200, package=0, logistics=0, addons=0, misc_total=0,
                          cr_cost=0, damage_cost=0, gst=18, profit_percentage=0)
    assert r["bs_wo_gst"] == 200.0
    assert r["bank_settlement"] == 236.0     # 200 + round(200×18%,2)=36.00


# ── bs_wo_gst rounds to the nearest whole rupee ───────────────────────────────
def test_pre_gst_rounds_to_whole_rupee():
    # breakeven 100.40 + profit 0 = 100.40 → rounds down to 100
    down = calculate_pricing(100.40, 0, 0, 0, 0, 0, 0, gst=0, profit_percentage=0)
    assert down["bs_wo_gst"] == 100.0
    # breakeven 100.60 → rounds up to 101
    up = calculate_pricing(100.60, 0, 0, 0, 0, 0, 0, gst=0, profit_percentage=0)
    assert up["bs_wo_gst"] == 101.0


# ── All-zero inputs don't blow up ─────────────────────────────────────────────
def test_all_zero():
    r = calculate_pricing(0, 0, 0, 0, 0, 0, 0, gst=0, profit_percentage=0)
    assert r == {"breakeven": 0.0, "net_profit_amt": 0.0,
                 "bs_wo_gst": 0.0, "bank_settlement": 0.0}
