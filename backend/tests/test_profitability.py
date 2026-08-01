"""Unit tests for SKU profit intelligence pure function."""
import pytest
from app.services.profitability import build_sku_intelligence


def _row(sku, platform="Flipkart", net_units=10, payout=2000.0,
         breakeven=150.0, target_pct=20.0, returned_units=0):
    return dict(sku=sku, platform=platform, net_units=net_units, payout=payout,
                breakeven=breakeven, target_pct=target_pct, returned_units=returned_units)


# ── Empty / no data ───────────────────────────────────────────────────────────

def test_empty_rows():
    out = build_sku_intelligence([])
    assert out["summary"]["total_skus"] == 0
    assert out["summary"]["blended_margin_pct"] is None
    assert out["heroes"] == []
    assert out["kill_list"] == []
    assert out["all_skus"] == []


# ── Single profitable SKU ───────────────────────────────────────────────────────

def test_single_profitable():
    # 10 units, payout 2000 → 200/unit; breakeven 150 → cost 1500; profit 500; margin 33.3%
    out = build_sku_intelligence([_row("A", net_units=10, payout=2000.0, breakeven=150.0)])
    s = out["all_skus"][0]
    assert s["sku"] == "A"
    assert s["net_units"] == 10
    assert s["cost"] == 1500.0
    assert s["net_profit"] == 500.0
    assert s["margin_pct"] == 33.3
    assert s["status"] == "profit"
    assert out["summary"]["profitable"] == 1
    assert out["summary"]["blended_margin_pct"] == 33.3


# ── Loss-making SKU lands in kill list ──────────────────────────────────────────

def test_loss_making_in_kill_list():
    # payout 1000 over 10 units = 100/unit; breakeven 150 → cost 1500; profit -500; margin -33.3
    out = build_sku_intelligence([_row("LOSS", net_units=10, payout=1000.0, breakeven=150.0)])
    s = out["all_skus"][0]
    assert s["status"] == "loss"
    assert s["margin_pct"] == -33.3
    assert out["summary"]["loss_making"] == 1
    assert out["kill_list"][0]["sku"] == "LOSS"


# ── Thin margin classification (0 ≤ margin < 5) ──────────────────────────────────

def test_thin_margin():
    # payout 1530 / 10 = 153/unit; cost 1500; profit 30; margin 2.0%
    out = build_sku_intelligence([_row("THIN", net_units=10, payout=1530.0, breakeven=150.0)])
    s = out["all_skus"][0]
    assert s["status"] == "thin"
    assert s["margin_pct"] == 2.0
    assert out["summary"]["thin_margin"] == 1
    assert out["heroes"] == []        # thin is not a hero
    assert out["kill_list"] == []     # thin is not a kill


# ── Multi-platform aggregation for same SKU ──────────────────────────────────────

def test_multi_platform_same_sku():
    rows = [
        _row("MULTI", platform="Flipkart", net_units=10, payout=2000.0, breakeven=150.0),
        _row("MULTI", platform="Meesho",   net_units=5,  payout=900.0,  breakeven=150.0),
    ]
    out = build_sku_intelligence(rows)
    assert out["summary"]["total_skus"] == 1          # collapsed to one master SKU
    s = out["all_skus"][0]
    assert s["platforms"] == ["Flipkart", "Meesho"]
    assert s["net_units"] == 15
    assert s["payout"] == 2900.0
    assert s["cost"] == 2250.0                          # (10+5)*150
    assert s["net_profit"] == 650.0


# ── Return rate computed from returned + net ─────────────────────────────────────

def test_return_rate():
    out = build_sku_intelligence([_row("R", net_units=8, returned_units=2)])
    s = out["all_skus"][0]
    assert s["return_rate"] == 20.0      # 2 / (8+2)


# ── Variance vs target ───────────────────────────────────────────────────────────

def test_variance_vs_target():
    # margin 33.3, target 20 → +13.3pp
    out = build_sku_intelligence([_row("V", net_units=10, payout=2000.0, breakeven=150.0, target_pct=20.0)])
    assert out["all_skus"][0]["variance_pp"] == 13.3


# ── Heroes ranked by margin desc, capped ─────────────────────────────────────────

def test_heroes_ranked_and_capped():
    rows = [_row(f"H{i}", net_units=10, payout=2000.0 + i * 100, breakeven=150.0) for i in range(8)]
    out = build_sku_intelligence(rows)
    assert len(out["heroes"]) == 5                       # capped at HERO_LIMIT
    margins = [h["margin_pct"] for h in out["heroes"]]
    assert margins == sorted(margins, reverse=True)      # descending


# ── Zero breakeven → no_cost status, excluded from margin math ───────────────────

def test_zero_breakeven_no_cost():
    out = build_sku_intelligence([_row("Z", net_units=10, payout=2000.0, breakeven=0.0)])
    s = out["all_skus"][0]
    assert s["margin_pct"] is None
    assert s["status"] == "no_cost"
    assert out["summary"]["blended_margin_pct"] is None


# ── Blended margin across mixed SKUs ─────────────────────────────────────────────

def test_blended_margin_mixed():
    rows = [
        _row("WIN",  net_units=10, payout=2000.0, breakeven=150.0),   # +500
        _row("LOSE", net_units=10, payout=1000.0, breakeven=150.0),   # -500
    ]
    out = build_sku_intelligence(rows)
    # total payout 3000, cost 3000 → 0 profit → 0.0% blended
    assert out["summary"]["net_profit"] == 0.0
    assert out["summary"]["blended_margin_pct"] == 0.0
    assert out["summary"]["profitable"] == 1
    assert out["summary"]["loss_making"] == 1
