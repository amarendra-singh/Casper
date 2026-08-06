"""
Settlement Reconciliation Service
=================================

Surfaces where money is stuck or leaking in real platform settlement data:
  • Cash position   — settled vs pending (cash the platform still owes you).
  • Fee load        — total platform fees as % of gross, flagged per platform.
  • Underpayment     — SKUs where the platform settled less per unit than the
                      Casper-expected bank settlement (recoverable variance).

Layers (clean architecture):
  • build_reconciliation(reports, watch_rows) — PURE, unit-testable.
  • compute_reconciliation(db)                — async DB wrapper.
"""
from __future__ import annotations

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.pnl import PnlReport, PnlSkuRow
from app.services.scope import company_ids
from app.models.sku import SkuPricing, Sku
from app.models.platform import Platform


# A platform whose fees exceed this share of gross is flagged for review.
FEE_LOAD_FLAG_PCT = 25.0
# Per-unit underpayment below this (₹) is treated as recoverable, not noise.
UNDERPAY_MIN_RS = 1.0
UNDERPAY_LIMIT = 10


def build_reconciliation(reports: list[dict], watch_rows: list[dict]) -> dict:
    """
    reports: per-platform settlement summary:
        {platform, gross_sales, bank_settlement, amount_settled, amount_pending, fees}
    watch_rows: per matched SKU line:
        {sku, platform, expected_bs_per_unit, actual_bs_total, net_units}
    """
    platforms: list[dict] = []
    tot_settle = tot_settled = tot_pending = tot_gross = tot_fees = 0.0
    for r in reports:
        bs      = float(r.get("bank_settlement") or 0.0)
        settled = float(r.get("amount_settled") or 0.0)
        pending = float(r.get("amount_pending") or 0.0)
        gross   = float(r.get("gross_sales") or 0.0)
        # Fee sign convention differs by platform parser (FK stores expenses
        # negative, Snapdeal positive). Fees are a cost regardless of sign.
        fees    = abs(float(r.get("fees") or 0.0))
        settled_pct = round(settled / bs * 100, 1) if bs else None
        fee_load    = round(fees / gross * 100, 1) if gross else None
        platforms.append({
            "platform": r["platform"],
            "bank_settlement": round(bs, 2),
            "settled": round(settled, 2),
            "pending": round(pending, 2),
            "settled_pct": settled_pct,
            "fee_load_pct": fee_load,
            "fee_flag": bool(fee_load is not None and fee_load > FEE_LOAD_FLAG_PCT),
        })
        tot_settle += bs; tot_settled += settled; tot_pending += pending
        tot_gross += gross; tot_fees += fees

    # Per-SKU underpayment vs Casper-expected settlement (recoverable).
    underpaid: list[dict] = []
    total_recoverable = 0.0
    for w in watch_rows:
        units = int(w.get("net_units") or 0)
        exp_pu = float(w.get("expected_bs_per_unit") or 0.0)
        actual_total = float(w.get("actual_bs_total") or 0.0)
        if units <= 0 or exp_pu <= 0:
            continue
        actual_pu = actual_total / units
        gap_pu = actual_pu - exp_pu          # negative = underpaid
        if gap_pu < -UNDERPAY_MIN_RS:
            gap_total = round(gap_pu * units, 2)
            total_recoverable += -gap_total       # positive magnitude of under-settlement
            underpaid.append({
                "sku": w["sku"],
                "platform": w["platform"],
                "expected_per_unit": round(exp_pu, 2),
                "actual_per_unit": round(actual_pu, 2),
                "gap_per_unit": round(gap_pu, 2),
                "net_units": units,
                "gap_total": gap_total,
            })

    underpaid.sort(key=lambda x: x["gap_total"])   # most negative first
    settled_pct = round(tot_settled / tot_settle * 100, 1) if tot_settle else None
    fee_load    = round(tot_fees / tot_gross * 100, 1) if tot_gross else None

    return {
        "summary": {
            "bank_settlement": round(tot_settle, 2),
            "settled": round(tot_settled, 2),
            "pending": round(tot_pending, 2),
            "settled_pct": settled_pct,
            "fee_load_pct": fee_load,
            "total_fees": round(tot_fees, 2),
            "recoverable": round(total_recoverable, 2),
            "underpaid_skus": len(underpaid),
        },
        "platforms": platforms,
        "underpaid": underpaid[:UNDERPAY_LIMIT],
    }


async def compute_reconciliation(db: AsyncSession, company_id: int | list[int]) -> dict:
    """Pull per-report settlement + per-SKU expected vs actual, feed pure fn."""
    _cids = company_ids(company_id)   # group mode passes several
    rep_res = await db.execute(
        select(
            Platform.name,
            func.coalesce(func.sum(PnlReport.gross_sales), 0.0),
            func.coalesce(func.sum(PnlReport.bank_settlement), 0.0),
            func.coalesce(func.sum(PnlReport.amount_settled), 0.0),
            func.coalesce(func.sum(PnlReport.amount_pending), 0.0),
            func.coalesce(func.sum(PnlReport.total_expenses), 0.0),
        )
        .join(Platform, Platform.id == PnlReport.platform_id)
        .where(PnlReport.company_id.in_(_cids))
        .group_by(Platform.name)
    )
    reports = [
        {
            "platform": r[0], "gross_sales": r[1], "bank_settlement": r[2],
            "amount_settled": r[3], "amount_pending": r[4], "fees": r[5],
        }
        for r in rep_res.all()
    ]

    watch_res = await db.execute(
        select(
            Sku.shringar_sku,
            Platform.name,
            PnlSkuRow.casper_expected_bs,
            PnlSkuRow.bank_settlement_projected,
            PnlSkuRow.net_units,
        )
        .join(SkuPricing, SkuPricing.id == PnlSkuRow.sku_pricing_id)
        .join(Sku, Sku.id == SkuPricing.sku_id)
        .join(Platform, Platform.id == SkuPricing.platform_id)
        .where(
            PnlSkuRow.company_id.in_(_cids),
            PnlSkuRow.sku_pricing_id.isnot(None),
            PnlSkuRow.casper_expected_bs.isnot(None),
            PnlSkuRow.bank_settlement_projected.isnot(None),
            PnlSkuRow.net_units > 0,
        )
    )
    watch_rows = [
        {
            "sku": r[0], "platform": r[1],
            "expected_bs_per_unit": r[2], "actual_bs_total": r[3], "net_units": r[4],
        }
        for r in watch_res.all()
    ]
    return build_reconciliation(reports, watch_rows)
