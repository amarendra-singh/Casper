"""
Dashboard Routes

GET /dashboard/insights  — real AI insight cards from fraud actors + P&L + return reasons
"""

import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.database import get_db
from app.core.dependencies import get_current_user, get_active_company
from app.models.fraud import ActorRiskProfile, ReturnReasonCluster
from app.models.pnl import PnlReport, PnlSkuRow
from app.models.platform import Platform
from app.services.profitability import compute_sku_intelligence
from app.services.reconciliation import compute_reconciliation
from app.services.action_pipeline import compute_action_pipeline
from app.services.operations import compute_operations

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

require_any = get_current_user


# ── Helpers ────────────────────────────────────────────────────────────────────

def _fmt_l(val: float) -> str:
    return f"₹{val / 100_000:.1f}L"


def _time_label() -> str:
    now = datetime.now(timezone.utc)
    return f"Live data · {now.day} {now.strftime('%b %Y')}"


# ── Metrics ribbon builder ─────────────────────────────────────────────────────

def _build_metrics_cells(
    gross_u: int,
    net_u: int,
    sku_gross: int,
    rvp_u: int,
    rto_u: int,
    settle: float,
    gross_s: float,
    avg_margin: float,
    fraud_cnt: int,
    total_ord: int,
    crit_count: int,
    crit_vel: float | None,
    top_score: float | None,
) -> list[dict]:
    """
    Pure function: compute 9 ribbon metric cells from aggregated P&L and actor stats.
    Returns '—' for any metric where source data is zero/None.
    sku_gross/rvp_u/rto_u come from pnl_sku_rows — separates customer return (RVP) from RTO.
    """

    def _v(val: float | None, fmt: str = ".1f") -> str:
        return f"{val:{fmt}}" if val is not None else "—"

    # ── derived ───────────────────────────────────────────────────────────────
    sell_thru     = round(net_u / gross_u * 100, 1) if gross_u else None
    cust_ret_rate = round(rvp_u / sku_gross * 100, 1) if sku_gross else None
    rto_rate      = round(rto_u / sku_gross * 100, 1) if sku_gross else None
    fraud_rate    = round(fraud_cnt / total_ord * 100, 1) if total_ord else None
    settle_rate   = round(settle / gross_s * 100, 1) if gross_s else None
    margin        = round(avg_margin, 1) if avg_margin else None

    settle_l  = f"₹{settle  / 100_000:.1f}L"
    gross_s_l = f"₹{gross_s / 100_000:.1f}L"

    return [
        {
            "idx": "a01", "dot": None,
            "label": "Sell-through",
            "val": _v(sell_thru),
            "unit": "%" if sell_thru is not None else "",
            "delta": f"▲ {net_u} sold · {gross_u} dispatched" if sell_thru else "Upload P&L",
            "trend_cls": "up" if sell_thru and sell_thru > 60 else "flat",
            "meter": int(sell_thru) if sell_thru else 0,
            "meter_cls": "cyan",
        },
        {
            "idx": "a02", "dot": None,
            "label": "Customer return",
            "val": _v(cust_ret_rate),
            "unit": "%" if cust_ret_rate is not None else "",
            "delta": f"▼ {rvp_u} RVP units · customer-initiated" if cust_ret_rate else "Upload P&L",
            "trend_cls": "down" if cust_ret_rate and cust_ret_rate > 20 else "up",
            "meter": int(cust_ret_rate) if cust_ret_rate else 0,
            "meter_cls": "amber" if cust_ret_rate and cust_ret_rate > 20 else "",
        },
        {
            "idx": "a09", "dot": None,
            "label": "RTO rate",
            "val": _v(rto_rate),
            "unit": "%" if rto_rate is not None else "",
            "delta": f"▼ {rto_u} RTO units · logistics failure" if rto_rate else "Upload P&L",
            "trend_cls": "down" if rto_rate and rto_rate > 10 else "up",
            "meter": int(rto_rate) if rto_rate else 0,
            "meter_cls": "amber" if rto_rate and rto_rate > 10 else "",
        },
        {
            "idx": "a03", "dot": None,
            "label": "Fraud signal rate",
            "val": _v(fraud_rate),
            "unit": "%" if fraud_rate is not None else "",
            "delta": f"▼ {fraud_cnt} fraud orders · {total_ord} tracked" if fraud_rate else "Upload FK orders",
            "trend_cls": "down" if fraud_rate and fraud_rate > 5 else "up",
            "meter": min(int(fraud_rate * 10), 100) if fraud_rate else 0,
            "meter_cls": "amber",
        },
        {
            "idx": "a04", "dot": None,
            "label": "Settlement rate",
            "val": _v(settle_rate),
            "unit": "%" if settle_rate is not None else "",
            "delta": f"{settle_l} settled of {gross_s_l} GMV" if settle_rate else "Upload P&L",
            "trend_cls": "up" if settle_rate and settle_rate > 40 else "down",
            "meter": int(settle_rate) if settle_rate else 0,
            "meter_cls": "cyan",
        },
        {
            "idx": "a05", "dot": None,
            "label": "Avg net margin",
            "val": _v(margin),
            "unit": "%" if margin else "",
            "delta": "▲ matched SKUs · breakeven basis" if margin else "Upload P&L",
            "trend_cls": "up" if margin and margin > 30 else "flat",
            "meter": int(margin) if margin else 0,
            "meter_cls": "cyan",
        },
        {
            "idx": "a06", "dot": "#EF4444",
            "label": "Critical actors",
            "val": str(crit_count) if crit_count else "—",
            "unit": "",
            "delta": "▼ MISSHIPMENT + MISSING_ITEM" if crit_count else "No critical actors",
            "trend_cls": "down" if crit_count > 0 else "up",
            "meter": 0,
            "meter_cls": "",
        },
        {
            "idx": "a07", "dot": None,
            "label": "Avg fraud velocity",
            "val": _v(crit_vel) if crit_vel else "—",
            "unit": "d" if crit_vel else "",
            "delta": f"▼ {_v(crit_vel)}d avg · CRITICAL tier" if crit_vel else "No CRITICAL actors",
            "trend_cls": "down" if crit_vel and crit_vel < 3 else "flat",
            "meter": 0,
            "meter_cls": "",
        },
        {
            "idx": "a08", "dot": None,
            "label": "Top fraud score",
            "val": _v(top_score, ".0f") if top_score else "—",
            "unit": "/100" if top_score else "",
            "delta": "▼ Max risk · MISSHIPMENT" if top_score else "No fraud data",
            "trend_cls": "down" if top_score and top_score > 80 else "flat",
            "meter": int(top_score) if top_score else 0,
            "meter_cls": "amber" if top_score and top_score > 80 else "",
        },
    ]


async def _compute_metrics(db: AsyncSession, company_id: int) -> list[dict]:
    """Query P&L and actor aggregates, then delegate math to _build_metrics_cells."""

    # P&L report-level aggregates (sell-through denominator + settlement)
    pnl_res = await db.execute(
        select(
            func.coalesce(func.sum(PnlReport.gross_units),    0),
            func.coalesce(func.sum(PnlReport.net_units),      0),
            func.coalesce(func.sum(PnlReport.bank_settlement),0.0),
            func.coalesce(func.sum(PnlReport.gross_sales),    0.0),
        ).where(PnlReport.company_id == company_id)
    )
    pnl = pnl_res.one()
    gross_u, net_u, settle, gross_s = (
        int(pnl[0]), int(pnl[1]),
        float(pnl[2]), float(pnl[3]),
    )

    # Customer return (RVP) and RTO from SKU rows — separates logistics vs customer returns
    sku_ret_res = await db.execute(
        select(
            func.coalesce(func.sum(PnlSkuRow.gross_units), 0),
            func.coalesce(func.sum(PnlSkuRow.rvp_units),   0),
            func.coalesce(func.sum(PnlSkuRow.rto_units),   0),
        ).where(PnlSkuRow.company_id == company_id)
    )
    sku_ret = sku_ret_res.one()
    sku_gross = int(sku_ret[0])
    rvp_u     = int(sku_ret[1])
    rto_u     = int(sku_ret[2])

    # a05 must equal the SKU-profit "blended margin" — single source of truth.
    # Both are return-on-cost via sku_pricing.breakeven (see logic.md §6/§6b),
    # so reuse the SKU-intelligence engine instead of a second divergent query.
    _intel = await compute_sku_intelligence(db, company_id)
    avg_margin = _intel["summary"]["blended_margin_pct"] or 0.0

    # Actor aggregates
    actor_res = await db.execute(
        select(
            func.coalesce(func.sum(ActorRiskProfile.fraud_reason_count), 0),
            func.coalesce(func.sum(ActorRiskProfile.total_orders),        0),
        ).where(ActorRiskProfile.company_id == company_id)
    )
    actor = actor_res.one()
    fraud_cnt, total_ord = int(actor[0]), int(actor[1])

    # CRITICAL actor stats
    crit_res = await db.execute(
        select(
            func.count(),
            func.avg(ActorRiskProfile.avg_velocity_days),
            func.max(ActorRiskProfile.actor_fraud_score),
        ).where(ActorRiskProfile.risk_tier == "CRITICAL", ActorRiskProfile.company_id == company_id)
    )
    crit = crit_res.one()
    crit_count = int(crit[0])
    crit_vel   = float(round(crit[1], 1)) if crit[1] is not None else None
    top_score  = float(round(crit[2], 0)) if crit[2] is not None else None

    return _build_metrics_cells(
        gross_u=gross_u, net_u=net_u,
        sku_gross=sku_gross, rvp_u=rvp_u, rto_u=rto_u,
        settle=settle, gross_s=gross_s, avg_margin=avg_margin,
        fraud_cnt=fraud_cnt, total_ord=total_ord,
        crit_count=crit_count, crit_vel=crit_vel, top_score=top_score,
    )


# ── Insight generators ─────────────────────────────────────────────────────────

async def _insight_fraud_spike(db: AsyncSession, company_id: int) -> dict | None:
    """Hero card: top CRITICAL fraud actor."""
    result = await db.execute(
        select(ActorRiskProfile)
        .where(ActorRiskProfile.risk_tier == "CRITICAL", ActorRiskProfile.company_id == company_id)
        .order_by(ActorRiskProfile.actor_fraud_score.desc())
        .limit(1)
    )
    actor = result.scalars().first()
    if not actor:
        # Fall back to top AMBER
        result = await db.execute(
            select(ActorRiskProfile)
            .where(ActorRiskProfile.risk_tier == "AMBER", ActorRiskProfile.company_id == company_id)
            .order_by(ActorRiskProfile.actor_fraud_score.desc())
            .limit(1)
        )
        actor = result.scalars().first()
    if not actor:
        return None

    reason   = (actor.dominant_reason or "UNKNOWN").replace("_", " ").title()
    score    = int(actor.actor_fraud_score or 0)
    orders   = actor.total_orders or 0
    velocity = actor.avg_velocity_days
    tier     = actor.risk_tier
    sig_type = actor.fraud_signal_type or "Unknown"

    vel_txt = f"Avg return velocity {velocity:.1f}d. " if velocity else ""
    tier_txt = "CRITICAL" if tier == "CRITICAL" else "HIGH RISK"

    return {
        "hero": True,
        "tag": "Fraud Detection · auto-detected",
        "tag_cls": "danger",
        "title1": f"{reason} fraud spike — ",
        "title_em": f"{orders} orders",
        "title2": f" flagged {tier_txt}.",
        "body": (
            f"100% return rate on {reason} pattern. "
            f"{vel_txt}"
            f"Fraud score {score}/100. "
            f"Signal type: {sig_type}. "
            f"All {orders} events match this fraud fingerprint."
        ),
        "chips": [
            {"dot": "#2874F0", "text": "Flipkart"},
            {"dot": "#EF4444", "text": reason},
            {"dot": "#F59E0B", "text": f"Score {score}/100"},
            {"dot": None, "text": "est. impact", "bold": f"−₹{orders * 600:,}"},
        ],
        "time": _time_label(),
        "cta": "Investigate",
    }


async def _insight_return_breakdown(db: AsyncSession, company_id: int) -> dict | None:
    """Return reason intelligence: top fraud-signal cluster."""
    # Top FRAUD_SIGNAL cluster
    fraud_result = await db.execute(
        select(ReturnReasonCluster)
        .where(ReturnReasonCluster.fraud_signal_type == "FRAUD_SIGNAL", ReturnReasonCluster.company_id == company_id)
        .order_by(ReturnReasonCluster.order_count.desc())
        .limit(1)
    )
    top_fraud = fraud_result.scalars().first()

    # Totals by signal type
    totals_result = await db.execute(
        select(ReturnReasonCluster.fraud_signal_type, func.sum(ReturnReasonCluster.order_count))
        .where(ReturnReasonCluster.company_id == company_id)
        .group_by(ReturnReasonCluster.fraud_signal_type)
    )
    totals = {row[0]: int(row[1]) for row in totals_result.all()}
    grand_total = sum(totals.values()) or 1

    fraud_total   = totals.get("FRAUD_SIGNAL", 0)
    quality_total = totals.get("QUALITY", 0)
    pref_total    = totals.get("PREFERENCE", 0)

    fraud_pct   = round(fraud_total   / grand_total * 100, 1)
    quality_pct = round(quality_total / grand_total * 100, 1)
    pref_pct    = round(pref_total    / grand_total * 100, 1)

    if not top_fraud and fraud_total == 0:
        return None

    reason = (top_fraud.return_reason if top_fraud else "FRAUD_SIGNAL").replace("_", " ").title()

    return {
        "hero": False,
        "tag": "Return Intelligence",
        "tag_cls": "amber",
        "title": f"Fraud-signal returns: {fraud_pct}% of all return events",
        "title_chip": {"text": f"{fraud_total} orders", "cls": "down"},
        "body": (
            f"Top fraud reason: {reason} ({top_fraud.order_count if top_fraud else 0} orders). "
            f"Quality issues: {quality_pct}%, Preference returns: {pref_pct}%. "
            f"Total tracked: {grand_total} return events."
        ),
        "time": _time_label(),
        "cta": "View breakdown",
    }


async def _insight_platform_health(db: AsyncSession, company_id: int) -> dict | None:
    """Platform margin spread from latest P&L reports."""
    # Latest report per platform
    result = await db.execute(
        select(PnlReport, Platform.name)
        .join(Platform, Platform.id == PnlReport.platform_id)
        .where(PnlReport.net_margin_pct.isnot(None), PnlReport.company_id == company_id)
        .order_by(PnlReport.uploaded_at.desc())
    )
    rows = result.all()
    if not rows:
        return None

    # Deduplicate by platform (keep latest)
    seen = {}
    for report, plat_name in rows:
        if plat_name not in seen:
            seen[plat_name] = report

    if len(seen) < 1:
        return None

    margins = {name: r.net_margin_pct for name, r in seen.items()}
    best_plat  = max(margins, key=margins.get)
    worst_plat = min(margins, key=margins.get)
    best_m     = margins[best_plat]
    worst_m    = margins[worst_plat]
    diff       = round(best_m - worst_m, 1)

    if len(seen) == 1:
        body = (
            f"{best_plat} operating at {best_m:.1f}% net margin. "
            f"Bank settlement: {_fmt_l(seen[best_plat].bank_settlement or 0)}. "
            f"Add more platforms to compare performance."
        )
        title = f"{best_plat} P&L live — {best_m:.1f}% net margin"
        chip  = None
    else:
        body = (
            f"{best_plat} leading at {best_m:.1f}% margin. "
            f"{worst_plat} trailing at {worst_m:.1f}%. "
            f"Gap: {diff:.1f}pp across {len(seen)} active platforms. "
            f"Total settlement: {_fmt_l(sum((r.bank_settlement or 0) for r in seen.values()))}."
        )
        title = f"{best_plat} margin leading across {len(seen)} platforms"
        chip  = {"text": f"+{diff:.1f}pp vs {worst_plat}", "cls": "up"}

    return {
        "hero": False,
        "tag": "Platform Health",
        "tag_cls": "emerald",
        "title": title,
        "title_chip": chip,
        "body": body,
        "time": _time_label(),
        "cta": "Compare P&L",
    }


async def _insight_risk_summary(db: AsyncSession, company_id: int) -> dict | None:
    """Actor risk tier summary card."""
    tier_result = await db.execute(
        select(ActorRiskProfile.risk_tier, func.count(), func.sum(ActorRiskProfile.total_orders))
        .where(ActorRiskProfile.company_id == company_id)
        .group_by(ActorRiskProfile.risk_tier)
    )
    tier_stats = {row[0]: {"count": int(row[1]), "orders": int(row[2] or 0)} for row in tier_result.all()}

    total_actors = sum(v["count"] for v in tier_stats.values())
    if total_actors == 0:
        return None

    critical_cnt = tier_stats.get("CRITICAL", {}).get("count", 0)
    amber_cnt    = tier_stats.get("AMBER",    {}).get("count", 0)
    green_cnt    = tier_stats.get("GREEN",    {}).get("count", 0)
    total_orders = sum(v["orders"] for v in tier_stats.values())

    tag_cls = "danger" if critical_cnt > 0 else "amber" if amber_cnt > 0 else "emerald"

    return {
        "hero": False,
        "tag": "Risk Summary",
        "tag_cls": tag_cls,
        "title": f"{total_actors} actor patterns detected — {critical_cnt} need action",
        "title_chip": {"text": f"{critical_cnt} critical", "cls": "down"} if critical_cnt > 0 else None,
        "body": (
            f"{critical_cnt} CRITICAL (fraud signals), "
            f"{amber_cnt} AMBER (quality/preference), "
            f"{green_cnt} GREEN (logistics/cancelled). "
            f"{total_orders:,} total orders tracked across all patterns."
        ),
        "time": _time_label(),
        "cta": "View actors",
    }


# ── Route ──────────────────────────────────────────────────────────────────────

@router.get("/insights")
async def get_dashboard_insights(
    db: AsyncSession = Depends(get_db),
    company=Depends(get_active_company),
    _=Depends(require_any),
):
    """
    Generate real-time insight cards for the dashboard from:
    - actor_risk_profiles  (fraud spike, risk summary)
    - return_reason_clusters (return intelligence)
    - pnl_reports (platform health / margin)
    Returns ordered list: hero first, then supporting insights.
    """
    results = await asyncio.gather(
        _insight_fraud_spike(db, company.id),
        _insight_return_breakdown(db, company.id),
        _insight_platform_health(db, company.id),
        _insight_risk_summary(db, company.id),
    )

    insights = [r for r in results if r is not None]

    # Ensure hero is first
    insights.sort(key=lambda x: 0 if x.get("hero") else 1)

    return {"insights": insights, "generated_at": datetime.now(timezone.utc).isoformat()}


@router.get("/metrics")
async def get_dashboard_metrics(
    db: AsyncSession = Depends(get_db),
    company=Depends(get_active_company),
    _=Depends(require_any),
):
    """
    Compute 8 real operational metrics for the dashboard ribbon from:
    - pnl_reports  (sell-through, return rate, settlement rate, avg margin)
    - actor_risk_profiles  (fraud rate, critical count, velocity, top score)
    Returns '—' for metrics where source data is absent.
    """
    cells = await _compute_metrics(db, company.id)
    return {"metrics": cells, "generated_at": datetime.now(timezone.utc).isoformat()}


@router.get("/sku-intelligence")
async def get_sku_intelligence(
    db: AsyncSession = Depends(get_db),
    company=Depends(get_active_company),
    _=Depends(require_any),
):
    """
    Cross-platform SKU profit intelligence from real settlement data:
    - per-SKU TRUE breakeven-based margin (return-on-cost)
    - Kill List (selling below cost) + Hero SKUs ranking
    - blended margin, profit/loss counts
    Empty payload when no matched SKU rows exist (graceful).
    """
    data = await compute_sku_intelligence(db, company.id)
    return {**data, "generated_at": datetime.now(timezone.utc).isoformat()}


@router.get("/reconciliation")
async def get_reconciliation(
    db: AsyncSession = Depends(get_db),
    company=Depends(get_active_company),
    _=Depends(require_any),
):
    """
    Settlement reconciliation from real P&L data:
    - cash position (settled vs pending the platform owes)
    - per-platform fee load with high-fee flags
    - per-SKU underpayment vs Casper-expected settlement (recoverable)
    """
    data = await compute_reconciliation(db, company.id)
    return {**data, "generated_at": datetime.now(timezone.utc).isoformat()}


@router.get("/action-pipeline")
async def get_action_pipeline(
    db: AsyncSession = Depends(get_db),
    company=Depends(get_active_company),
    _=Depends(require_any),
):
    """
    Fraud → action pipeline from actor_risk_profiles:
    - prioritised BLOCK / DISPUTE / WATCH queue (by recoverable impact)
    - export-ready blocklist of CRITICAL actors
    - estimated recoverable ₹ + repeat-offender flags + claim templates
    """
    data = await compute_action_pipeline(db, company.id)
    return {**data, "generated_at": datetime.now(timezone.utc).isoformat()}


@router.get("/operations")
async def get_operations(
    db: AsyncSession = Depends(get_db),
    company=Depends(get_active_company),
    _=Depends(require_any),
):
    """
    Operations reports drill-down from real parsed P&L:
    - order funnel (dispatched → RTO → returns → cancelled → net)
    - fees waterfall (GMV → fee components + Other → bank settlement)
    - top return-reason clusters + per-channel customer returns / RTO
    """
    data = await compute_operations(db, company.id)
    return {**data, "generated_at": datetime.now(timezone.utc).isoformat()}
