"""
SKU Profit Intelligence Service
================================

Computes TRUE, breakeven-based profitability per SKU from actual platform
settlement data — the core financial value of Casper.

Two layers (clean architecture):
  • build_sku_intelligence(rows)   — PURE function, no DB. Fully unit-testable.
  • compute_sku_intelligence(db)   — async DB wrapper that feeds the pure fn.

Margin definition (locked, see memory/logic.md §6):
    real_margin = (actual_payout - breakeven_cost) / breakeven_cost × 100
Breakeven is the cost floor (Landed Cost + Reserves), frozen per SKU in
sku_pricing.breakeven. Payout is what the platform actually settled
(bank_settlement_projected). This is return-on-COST, applied uniformly.
"""
from __future__ import annotations

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.pnl import PnlSkuRow
from app.models.sku import SkuPricing, Sku
from app.models.platform import Platform


# Status thresholds (margin %, return-on-cost)
THIN_MARGIN_CEILING = 5.0   # below this (but ≥0) = thin / at-risk
HERO_LIMIT = 5
KILL_LIMIT = 10


def _classify(margin: float | None) -> str:
    if margin is None:
        return "no_cost"
    if margin < 0:
        return "loss"
    if margin < THIN_MARGIN_CEILING:
        return "thin"
    return "profit"


def build_sku_intelligence(rows: list[dict]) -> dict:
    """
    Pure: aggregate matched P&L lines into per-SKU profitability intelligence.

    Each row (one matched (sku, platform) P&L line):
        sku             str
        platform        str
        net_units       int    — units that actually settled
        payout          float  — bank_settlement_projected for those units
        breakeven       float  — cost floor per unit (no-GST)
        target_pct      float  — Casper's target profit % (for variance)
        returned_units  int    — rvp + rto + cancelled (for return drag)
    """
    by_sku: dict[str, dict] = {}
    for r in rows:
        units = int(r.get("net_units") or 0)
        s = by_sku.setdefault(r["sku"], {
            "sku": r["sku"], "platforms": set(),
            "net_units": 0, "payout": 0.0, "cost": 0.0,
            "returned_units": 0, "target_pct": r.get("target_pct"),
        })
        s["platforms"].add(r["platform"])
        s["net_units"] += units
        s["payout"] += float(r.get("payout") or 0.0)
        s["cost"] += float(r.get("breakeven") or 0.0) * units
        s["returned_units"] += int(r.get("returned_units") or 0)

    skus: list[dict] = []
    for s in by_sku.values():
        cost, payout = s["cost"], s["payout"]
        profit = payout - cost
        margin = round(profit / cost * 100, 1) if cost else None
        gross = s["net_units"] + s["returned_units"]
        ret_rate = round(s["returned_units"] / gross * 100, 1) if gross else None
        target = s["target_pct"]
        # variance vs target: how far actual margin beats/misses the plan
        variance = round(margin - target, 1) if (margin is not None and target is not None) else None
        skus.append({
            "sku": s["sku"],
            "platforms": sorted(s["platforms"]),
            "net_units": s["net_units"],
            "payout": round(payout, 2),
            "cost": round(cost, 2),
            "net_profit": round(profit, 2),
            "margin_pct": margin,
            "target_pct": target,
            "variance_pp": variance,
            "return_rate": ret_rate,
            "status": _classify(margin),
        })

    profitable = [s for s in skus if s["status"] == "profit"]
    thin       = [s for s in skus if s["status"] == "thin"]
    loss       = [s for s in skus if s["status"] == "loss"]

    total_payout = round(sum(s["payout"] for s in skus), 2)
    total_cost   = round(sum(s["cost"] for s in skus), 2)
    total_profit = round(total_payout - total_cost, 2)
    blended      = round(total_profit / total_cost * 100, 1) if total_cost else None

    # Heroes: highest real margin. Kill list: most negative (selling below cost).
    heroes = sorted(profitable, key=lambda x: x["margin_pct"], reverse=True)[:HERO_LIMIT]
    kill_list = sorted(loss, key=lambda x: x["margin_pct"])[:KILL_LIMIT]

    # Full table: profit→thin→loss→no_cost, each by margin desc; nulls last.
    all_sorted = sorted(
        skus, key=lambda x: (x["margin_pct"] is None, -(x["margin_pct"] or 0))
    )

    return {
        "summary": {
            "total_skus": len(skus),
            "profitable": len(profitable),
            "thin_margin": len(thin),
            "loss_making": len(loss),
            "total_payout": total_payout,
            "total_cost": total_cost,
            "net_profit": total_profit,
            "blended_margin_pct": blended,
        },
        "heroes": heroes,
        "kill_list": kill_list,
        "all_skus": all_sorted,
    }


async def compute_sku_intelligence(db: AsyncSession) -> dict:
    """Join matched P&L rows → pricing → master SKU/platform, feed pure fn."""
    result = await db.execute(
        select(
            Sku.shringar_sku,
            Platform.name,
            PnlSkuRow.net_units,
            PnlSkuRow.bank_settlement_projected,
            SkuPricing.breakeven,
            SkuPricing.profit_percentage,
            func.coalesce(PnlSkuRow.rvp_units, 0)
            + func.coalesce(PnlSkuRow.rto_units, 0)
            + func.coalesce(PnlSkuRow.cancelled_units, 0),
        )
        .join(SkuPricing, SkuPricing.id == PnlSkuRow.sku_pricing_id)
        .join(Sku, Sku.id == SkuPricing.sku_id)
        .join(Platform, Platform.id == SkuPricing.platform_id)
        .where(
            PnlSkuRow.sku_pricing_id.isnot(None),
            PnlSkuRow.bank_settlement_projected.isnot(None),
            SkuPricing.breakeven.isnot(None),
            SkuPricing.breakeven != 0,
        )
    )
    rows = [
        {
            "sku": r[0],
            "platform": r[1],
            "net_units": r[2],
            "payout": r[3],
            "breakeven": r[4],
            "target_pct": r[5],
            "returned_units": r[6],
        }
        for r in result.all()
    ]
    return build_sku_intelligence(rows)
