"""
Operations Reports Service
==========================

Powers the dashboard "Reports" drill-down from real parsed P&L data:
  • Order funnel        — dispatched → RTO → customer returns → cancelled → net.
  • Fees waterfall      — GMV → known fee components + Other → bank settlement.
  • Return reasons      — top return-reason clusters by order volume.
  • Returns by channel  — per-platform customer returns (RVP) and RTO.

Layers (clean architecture, matches sibling services):
  • build_operations(units, fees, reasons, channels) — PURE, unit-testable.
  • compute_operations(db)                           — async DB wrapper.

Fee sign convention differs per platform parser (FK stores expenses negative,
Snapdeal mixes signs), so every fee is reduced to a positive magnitude. The
"Other fees" bucket = |total_expenses| − Σ(known components), keeping the
waterfall balanced to the actual settlement regardless of which line items a
given platform broke out.
"""
from __future__ import annotations

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.pnl import PnlReport, PnlSkuRow
from app.models.platform import Platform
from app.models.fraud import ReturnReasonCluster


REASON_LIMIT = 6
# Stable palette for the return-reason donut (color-blind-safe-ish, matches Pulse).
_REASON_COLORS = ["#3B7CE8", "#F43397", "#FF9900", "#C43BCC", "#16B8A6", "#A8A39A"]


def _clean_reason(raw: str | None) -> str:
    return (raw or "Unknown").replace("_", " ").strip().title()


def build_operations(units: dict, fees: dict, reasons: list[dict], channels: list[dict]) -> dict:
    """
    units:    {gross, rto, rvp, cancelled, net}
    fees:     {gross_sales, commission, marketing, courier, collection, tcs,
               total_expenses, bank_settlement}
    reasons:  [{reason, count}]  (pre-aggregated, any order)
    channels: [{platform, rvp, rto}]
    """
    # ── Order funnel ────────────────────────────────────────────────────────
    gross = int(units.get("gross") or 0)
    rto = int(units.get("rto") or 0)
    rvp = int(units.get("rvp") or 0)
    cancelled = int(units.get("cancelled") or 0)
    net = int(units.get("net") or 0)

    def _pct(v: int) -> float:
        return round(v / gross * 100, 1) if gross else 0.0

    funnel = [
        {"label": "Dispatched", "value": gross, "pct": _pct(gross), "kind": "base"},
        {"label": "RTO (logistics)", "value": rto, "pct": _pct(rto), "kind": "loss"},
        {"label": "Customer returns", "value": rvp, "pct": _pct(rvp), "kind": "loss"},
        {"label": "Cancelled", "value": cancelled, "pct": _pct(cancelled), "kind": "loss"},
        {"label": "Net delivered", "value": net, "pct": _pct(net), "kind": "net"},
    ]

    # ── Fees waterfall ──────────────────────────────────────────────────────
    gmv = float(fees.get("gross_sales") or 0.0)
    settlement = float(fees.get("bank_settlement") or 0.0)
    total_exp = abs(float(fees.get("total_expenses") or 0.0))

    components = [
        ("Commission", abs(float(fees.get("commission") or 0.0))),
        ("Ads & marketing", abs(float(fees.get("marketing") or 0.0))),
        ("Shipping & courier", abs(float(fees.get("courier") or 0.0))),
        ("Collection fee", abs(float(fees.get("collection") or 0.0))),
        ("GST / TCS", abs(float(fees.get("tcs") or 0.0))),
    ]
    known = sum(v for _, v in components)
    other = round(total_exp - known, 2)
    if other > 0.5:
        components.append(("Other fees", other))

    def _fpct(v: float) -> float:
        return round(v / gmv * 100, 1) if gmv else 0.0

    waterfall = [{"label": "Gross sales (GMV)", "value": round(gmv, 2), "pct": 100.0, "kind": "pos"}]
    for label, val in components:
        if val > 0.5:
            waterfall.append({"label": label, "value": round(val, 2), "pct": _fpct(val), "kind": "neg"})
    waterfall.append({"label": "Net settlement", "value": round(settlement, 2),
                      "pct": _fpct(settlement), "kind": "settle"})

    # ── Return reasons donut ────────────────────────────────────────────────
    cleaned: dict[str, int] = {}
    for r in reasons:
        cnt = int(r.get("count") or 0)
        if cnt <= 0:
            continue
        cleaned[_clean_reason(r.get("reason"))] = cleaned.get(_clean_reason(r.get("reason")), 0) + cnt
    ordered = sorted(cleaned.items(), key=lambda x: x[1], reverse=True)
    top = ordered[:REASON_LIMIT - 1]
    tail = sum(c for _, c in ordered[REASON_LIMIT - 1:])
    if tail > 0:
        top.append(("Other", tail))
    reason_total = sum(c for _, c in top) or 1
    return_reasons = [
        {"reason": name, "count": cnt,
         "pct": round(cnt / reason_total * 100, 1),
         "color": _REASON_COLORS[i % len(_REASON_COLORS)]}
        for i, (name, cnt) in enumerate(top)
    ]

    # ── Returns by channel ──────────────────────────────────────────────────
    by_channel = []
    for ch in channels:
        rvp_c = int(ch.get("rvp") or 0)
        rto_c = int(ch.get("rto") or 0)
        if rvp_c == 0 and rto_c == 0:
            continue
        by_channel.append({
            "platform": ch["platform"],
            "returns": rvp_c,
            "rto": rto_c,
            "total": rvp_c + rto_c,
        })
    by_channel.sort(key=lambda x: x["total"], reverse=True)

    return {
        "summary": {
            "dispatched": gross,
            "net_delivered": net,
            "rto_units": rto,
            "return_units": rvp,
            "rto_rate": _pct(rto),
            "return_rate": _pct(rvp),
            "gmv": round(gmv, 2),
            "settlement": round(settlement, 2),
            "fee_total": round(total_exp, 2),
        },
        "funnel": funnel,
        "fees": waterfall,
        "return_reasons": return_reasons,
        "returns_by_channel": by_channel,
    }


async def compute_operations(db: AsyncSession) -> dict:
    """Aggregate units, fees, return reasons, and per-channel returns, feed pure fn."""
    units_res = await db.execute(
        select(
            func.coalesce(func.sum(PnlSkuRow.gross_units), 0),
            func.coalesce(func.sum(PnlSkuRow.rto_units), 0),
            func.coalesce(func.sum(PnlSkuRow.rvp_units), 0),
            func.coalesce(func.sum(PnlSkuRow.cancelled_units), 0),
            func.coalesce(func.sum(PnlSkuRow.net_units), 0),
        )
    )
    u = units_res.one()
    units = {"gross": u[0], "rto": u[1], "rvp": u[2], "cancelled": u[3], "net": u[4]}

    fee_res = await db.execute(
        select(
            func.coalesce(func.sum(PnlReport.gross_sales), 0.0),
            func.coalesce(func.sum(PnlReport.commission_total), 0.0),
            func.coalesce(func.sum(PnlReport.marketing_fee), 0.0),
            func.coalesce(func.sum(PnlReport.courier_fee), 0.0),
            func.coalesce(func.sum(PnlReport.payment_collection_fee), 0.0),
            func.coalesce(func.sum(PnlReport.tcs_amount), 0.0),
            func.coalesce(func.sum(PnlReport.total_expenses), 0.0),
            func.coalesce(func.sum(PnlReport.bank_settlement), 0.0),
        )
    )
    f = fee_res.one()
    fees = {
        "gross_sales": f[0], "commission": f[1], "marketing": f[2], "courier": f[3],
        "collection": f[4], "tcs": f[5], "total_expenses": f[6], "bank_settlement": f[7],
    }

    reason_res = await db.execute(
        select(ReturnReasonCluster.return_reason, func.sum(ReturnReasonCluster.order_count))
        .group_by(ReturnReasonCluster.return_reason)
    )
    reasons = [{"reason": r[0], "count": r[1]} for r in reason_res.all()]

    chan_res = await db.execute(
        select(
            Platform.name,
            func.coalesce(func.sum(PnlSkuRow.rvp_units), 0),
            func.coalesce(func.sum(PnlSkuRow.rto_units), 0),
        )
        .join(PnlReport, PnlReport.id == PnlSkuRow.report_id)
        .join(Platform, Platform.id == PnlReport.platform_id)
        .group_by(Platform.name)
    )
    channels = [{"platform": r[0], "rvp": r[1], "rto": r[2]} for r in chan_res.all()]

    return build_operations(units, fees, reasons, channels)
