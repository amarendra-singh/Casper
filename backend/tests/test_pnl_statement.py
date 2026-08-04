"""Unit tests for the P&L statement engine (pure functions)."""
from app.services.pnl_statement import (
    build_pnl_statement, build_pnl_trend, build_consolidated, build_pnl_rows,
)


def test_build_pnl_rows_math_and_calc():
    rows = [{
        "id": 1, "platform_sku_name": "SKU-A", "gross_units": 20, "net_units": 10,
        "bank_settlement_projected": 1200, "commission_fee": -100, "taxes_gst": -50,
        "price": 30, "package": 5, "logistics": 8, "addons": 0, "misc_total": 4,
        "cr_cost": 3, "damage_cost": 2, "breakeven": 52, "breakeven_gst": 55,
        "target_pre_gst": 62, "target_post_gst": 65,
    }]
    out = build_pnl_rows(rows)
    r = out["rows"][0]
    assert r["fk_bs_per_unit"] == 120.0          # 1200 / 10
    assert r["expected_total"] == 520.0          # 52 × 10
    assert r["profit_no_gst"] == 68.0            # 120 − 52
    assert r["total_true_profit"] == 680.0       # 1200 − 520
    assert r["real_margin_pct"] == round(68 / 52 * 100, 2)
    assert r["return_rate_pct"] == 50.0          # (20−10)/20
    # calc breakdown: breakeven shows the full cost stack, footing to 52
    be_ops = dict((o[0], o[1]) for o in r["calc"]["casper_breakeven"]["ops"])
    assert be_ops["Product cost"] == 30 and be_ops["+ Return cost"] == 3
    assert r["calc"]["casper_breakeven"]["result"] == 52
    assert out["summary"]["total_profit"] == 680.0
    assert out["summary"]["profitable"] == 1


def _row(net_units, bsp, cogs_pu=0, misc_pu=0, ful_pu=0, ret_pu=0, matched=True, **fees):
    """Build a per-SKU row dict as the DB wrapper would."""
    return {
        "net_units": net_units,
        "gross_units": fees.get("gross_units", net_units),
        "bank_settlement_projected": bsp,
        "commission_fee": fees.get("commission_fee", 0),
        "reverse_shipping_fee": fees.get("reverse_shipping_fee", 0),
        "collection_fee": fees.get("collection_fee", 0),
        "fixed_fee": fees.get("fixed_fee", 0),
        "taxes_gst": fees.get("taxes_gst", 0),
        "matched": matched,
        "_cogs_total": cogs_pu * net_units,
        "_fulfillment_total": ful_pu * net_units,
        "_return_total": ret_pu * net_units,
        "_overhead_total": misc_pu * net_units,
    }


def test_full_cost_stack_including_return_cost():
    # payout 800; per-unit: cogs 30, fulfillment 10, return 5, overhead 4 (×10 units)
    rows = [_row(10, bsp=800, cogs_pu=30, ful_pu=10, ret_pu=5, misc_pu=4)]
    report = {"gross_sales": 1000, "returns_amount": 0, "net_sales": 1000, "bank_settlement": 800}
    s = build_pnl_statement(rows, report)
    st = s["subtotals"]
    assert st["cogs"] == 300
    assert st["fulfillment"] == 100
    assert st["return_cost"] == 50           # the return-cost line the user asked for
    assert st["overhead"] == 40
    assert st["total_cost"] == 490           # == breakeven × units
    assert st["contribution"] == 350         # 800 − 300 − 100 − 50
    assert st["operating_profit"] == 310     # 350 − 40 == payout(800) − total_cost(490)
    rc = next(l for l in s["lines"] if l["key"] == "return_cost")
    assert rc["amount"] == -50


def test_statement_foots_and_reconciles():
    # Net sales 1000, platform kept 200 → payout 800; COGS 500; overhead 100.
    rows = [_row(10, bsp=800, cogs_pu=50, misc_pu=10, commission_fee=150, taxes_gst=50)]
    report = {"gross_sales": 1100, "returns_amount": 100, "net_sales": 1000,
              "bank_settlement": 800, "marketing_fee": 0}
    s = build_pnl_statement(rows, report)
    st = s["subtotals"]
    assert st["net_sales"] == 1000
    assert st["net_payout"] == 800
    # Statement foots: net_sales − total_platform_fees == net_payout
    assert round(st["net_sales"] - st["total_platform_fees"], 2) == st["net_payout"]
    assert st["cogs"] == 500
    assert st["contribution"] == 300          # 800 payout − 500 cogs
    assert st["operating_profit"] == 200      # 300 − 100 overhead
    assert st["gross_profit"] == 500          # 1000 net sales − 500 cogs


def test_margins_are_revenue_anchored():
    rows = [_row(10, bsp=800, cogs_pu=50, misc_pu=10, commission_fee=200)]
    report = {"gross_sales": 1000, "returns_amount": 0, "net_sales": 1000, "bank_settlement": 800}
    m = build_pnl_statement(rows, report)["margins"]
    assert m["gross_margin_pct"] == 50.0        # 500/1000
    assert m["operating_margin_pct"] == 20.0    # 200/1000
    assert m["take_rate_pct"] == 20.0           # 200 fees / 1000


def test_other_fees_balancing_plug():
    # Identified fees (100) < actual gap (200) → Other fees = 100 so it foots.
    rows = [_row(10, bsp=800, commission_fee=100)]
    report = {"gross_sales": 1000, "returns_amount": 0, "net_sales": 1000, "bank_settlement": 800}
    s = build_pnl_statement(rows, report)
    other = next(l for l in s["lines"] if l["key"] == "other_fees")
    assert other["amount"] == -100.0
    assert s["subtotals"]["total_platform_fees"] == 200.0


def test_cogs_coverage_flag():
    rows = [_row(10, bsp=800, cogs_pu=50, matched=True),
            _row(10, bsp=700, cogs_pu=0, matched=False)]
    report = {"gross_sales": 2000, "returns_amount": 0, "net_sales": 2000, "bank_settlement": 1500}
    cov = build_pnl_statement(rows, report)["coverage"]
    assert cov["matched_units"] == 10
    assert cov["total_units"] == 20
    assert cov["cogs_coverage_pct"] == 50.0
    assert cov["reliable"] is False            # 50% < 70% threshold


def test_empty_statement_is_safe():
    s = build_pnl_statement([], {"gross_sales": 0, "returns_amount": 0, "net_sales": 0})
    assert s["subtotals"]["operating_profit"] == 0
    assert s["margins"]["gross_margin_pct"] is None


def test_trend_delta():
    periods = [
        {"period": "2026-03", "net_sales": 1000, "operating_profit": 100, "operating_margin_pct": 10.0, "net_units": 50},
        {"period": "2026-04", "net_sales": 1500, "operating_profit": 250, "operating_margin_pct": 16.7, "net_units": 70},
    ]
    t = build_pnl_trend(periods)
    assert len(t["series"]) == 2
    assert t["latest"]["period"] == "2026-04"
    assert t["delta"]["net_sales"] == 500
    assert t["delta"]["operating_profit"] == 150


def test_trend_single_period_no_delta():
    t = build_pnl_trend([{"period": "2026-03", "net_sales": 1000, "operating_profit": 100}])
    assert t["delta"] is None


def test_consolidated_blend():
    def stmt(platform, net_sales, op):
        return {"platform": platform,
                "subtotals": {"gross_sales": net_sales, "net_sales": net_sales,
                              "total_platform_fees": 0, "net_payout": net_sales,
                              "cogs": 0, "gross_profit": net_sales, "contribution": op,
                              "overhead": 0, "operating_profit": op},
                "margins": {"operating_margin_pct": round(op / net_sales * 100, 2)}}
    c = build_consolidated([stmt("Flipkart", 1000, 100), stmt("Meesho", 2000, 400)])
    assert c["subtotals"]["net_sales"] == 3000
    assert c["subtotals"]["operating_profit"] == 500
    assert c["margins"]["operating_margin_pct"] == round(500 / 3000 * 100, 2)
    assert len(c["platforms"]) == 2
