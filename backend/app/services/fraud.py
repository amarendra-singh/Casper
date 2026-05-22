"""
Fraud Detection Service — Intelligent Return & Risk Analysis

Order Event Extraction (called at upload time):
  extract_order_events_fk()        — from FK "Orders P&L" sheet
  extract_order_events_meesho()    — from Meesho "Order Payments" sheet
  extract_order_events_snapdeal_cpr() — from Snapdeal CPR flat sheet

Intelligence Engine (called after every upload):
  compute_sku_risk_scores()        — Z-score based risk per SKU per platform
  get_fraud_dashboard()            — aggregated view for UI

Status normalisation across all platforms → DELIVERED | RETURNED | RTO |
  CANCELLED | PENDING_RETURN | IN_TRANSIT
Payment mode normalisation → prepaid | postpaid | unknown
"""

from __future__ import annotations
from datetime import datetime, date
from typing import Optional
import math

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func, text

from app.models.fraud import OrderEvent, SkuRiskScore
from app.models.pnl import PnlReport
from app.models.platform import Platform
from app.models.sku import SkuPricing, SkuPlatformConfig


# ── Status normalisation maps ─────────────────────────────────────────────────

_FK_STATUS_MAP = {
    "DELIVERED":        "DELIVERED",
    "RETURNED":         "RETURNED",
    "CANCELLED":        "CANCELLED",
    "RETURN_REQUESTED": "PENDING_RETURN",
    "RETURN_CANCELLED": "DELIVERED",      # return rejected; item stays with buyer
}

_MEESHO_STATUS_MAP = {
    "Delivered":  "DELIVERED",
    "Return":     "RETURNED",
    "RTO":        "RTO",
    "Cancelled":  "CANCELLED",
    "Shipped":    "IN_TRANSIT",
}

_CPR_STATUS_MAP = {
    "Delivered":        "DELIVERED",
    "Courier Return":   "RTO",
    "Customer Return":  "RETURNED",
    "Seller Cancelled": "CANCELLED",
    "Courier Cancelled": "CANCELLED",
    "Shipped":          "IN_TRANSIT",
    "To be Shipped":    "IN_TRANSIT",
}

_FK_PAYMENT_MAP = {
    "prepaid":     "prepaid",
    "postpaid":    "postpaid",    # COD-equivalent on FK
    "part_payment": "postpaid",
}


# ── FK order extraction ───────────────────────────────────────────────────────

def extract_order_events_fk(file_bytes: bytes) -> list[dict]:
    """
    Extract per-order rows from FK 'Orders P&L' sheet.
    Row 0 = headers, Row 1 = sub-headers (skipped), Row 2+ = data.
    Returns list of dicts ready for OrderEvent insertion.
    """
    from io import BytesIO
    import pandas as pd
    import warnings
    warnings.filterwarnings("ignore", category=UserWarning)

    df = pd.read_excel(
        BytesIO(file_bytes), sheet_name="Orders P&L",
        header=0,
        skiprows=lambda i: i == 1,   # skip sub-header row
    )

    # Normalise column names: strip whitespace
    df.columns = [str(c).strip() for c in df.columns]

    # Drop rows where Order ID is null (footer rows)
    df = df[df["Order ID"].notna()]

    # Identify sale + settlement columns by partial name
    sale_col = next((c for c in df.columns if "Accounted Net Sales" in c and "(INR)" in c), None)
    bs_col   = next((c for c in df.columns if "Bank Settlement" in c and "Projected" in c and ".1" not in c), None)

    events: list[dict] = []
    for _, row in df.iterrows():
        raw_status = str(row.get("Order Status", "")).strip()
        raw_payment = str(row.get("Mode of Payment", "")).strip().lower()
        order_date = row.get("Order Date")
        if hasattr(order_date, 'date'):
            order_date = order_date.date()
        elif isinstance(order_date, str):
            try:
                order_date = pd.to_datetime(order_date, errors="coerce").date()
            except Exception:
                order_date = None

        sale_val = None
        if sale_col:
            v = pd.to_numeric(row.get(sale_col), errors="coerce")
            sale_val = float(v) if not (v is None or (isinstance(v, float) and math.isnan(v))) else None

        bs_val = None
        if bs_col:
            v = pd.to_numeric(row.get(bs_col), errors="coerce")
            bs_val = float(v) if not (v is None or (isinstance(v, float) and math.isnan(v))) else None

        events.append({
            "external_order_id": str(row.get("Order ID", "")).strip(),
            "sku_platform_name":  str(row.get("SKU Name", "")).strip(),
            "order_date":         order_date,
            "order_status":       _FK_STATUS_MAP.get(raw_status, raw_status or "UNKNOWN"),
            "payment_mode":       _FK_PAYMENT_MAP.get(raw_payment, "unknown"),
            "sale_amount":        sale_val,
            "settled_amount":     bs_val,
        })

    return [e for e in events if e["sku_platform_name"]]


# ── Meesho order extraction ───────────────────────────────────────────────────

def extract_order_events_meesho(file_bytes: bytes) -> list[dict]:
    """Extract per-order rows from Meesho 'Order Payments' sheet."""
    from io import BytesIO
    import pandas as pd
    import warnings
    warnings.filterwarnings("ignore", category=UserWarning)

    df = pd.read_excel(
        BytesIO(file_bytes), sheet_name="Order Payments",
        skiprows=[0, 2], header=0,
    )
    df = df[df["Sub Order No"].notna()]

    events: list[dict] = []
    for _, row in df.iterrows():
        raw_status = str(row.get("Live Order Status", "")).strip()
        order_date = row.get("Order Date")
        if hasattr(order_date, 'date'):
            order_date = order_date.date()
        elif isinstance(order_date, str):
            try:
                order_date = pd.to_datetime(order_date, errors="coerce").date()
            except Exception:
                order_date = None

        sale_v = pd.to_numeric(row.get("Total Sale Amount (Incl. Shipping & GST)"), errors="coerce")
        sett_v = pd.to_numeric(row.get("Final Settlement Amount"), errors="coerce")

        events.append({
            "external_order_id": str(row.get("Sub Order No", "")).strip(),
            "sku_platform_name":  str(row.get("Supplier SKU", "")).strip(),
            "order_date":         order_date,
            "order_status":       _MEESHO_STATUS_MAP.get(raw_status, raw_status or "UNKNOWN"),
            "payment_mode":       "prepaid",   # Meesho is all-prepaid
            "sale_amount":        float(sale_v) if not (sale_v is None or (isinstance(sale_v, float) and math.isnan(sale_v))) else None,
            "settled_amount":     float(sett_v) if not (sett_v is None or (isinstance(sett_v, float) and math.isnan(sett_v))) else None,
        })

    return [e for e in events if e["sku_platform_name"]]


# ── Snapdeal CPR order extraction ─────────────────────────────────────────────

def extract_order_events_snapdeal_cpr(file_bytes: bytes) -> list[dict]:
    """Extract per-suborder rows from Snapdeal CPR flat sheet."""
    from io import BytesIO
    import pandas as pd
    import warnings
    warnings.filterwarnings("ignore", category=UserWarning)

    df = pd.read_excel(BytesIO(file_bytes), sheet_name=0)
    df = df[df["SubOrder Code"].notna()]

    events: list[dict] = []
    for _, row in df.iterrows():
        raw_status = str(row.get("Order Status", "")).strip()
        order_date = row.get("order_date")
        if hasattr(order_date, 'date'):
            order_date = order_date.date()
        elif isinstance(order_date, str):
            try:
                order_date = pd.to_datetime(order_date, errors="coerce").date()
            except Exception:
                order_date = None

        sale_v = pd.to_numeric(row.get("Order Amount"), errors="coerce")
        sett_v = pd.to_numeric(row.get("Settled"), errors="coerce")

        # Snapdeal payment mode: COD vs prepaid from Payment Status
        pay_status = str(row.get("Payment Status", "")).lower()
        payment_mode = "postpaid" if "cod" in pay_status else "prepaid"

        events.append({
            "external_order_id": str(row.get("SubOrder Code", "")).strip(),
            "sku_platform_name":  str(row.get("SKU", "")).strip(),
            "order_date":         order_date,
            "order_status":       _CPR_STATUS_MAP.get(raw_status, raw_status or "UNKNOWN"),
            "payment_mode":       payment_mode,
            "sale_amount":        float(sale_v) if not (sale_v is None or (isinstance(sale_v, float) and math.isnan(sale_v))) else None,
            "settled_amount":     float(sett_v) if not (sett_v is None or (isinstance(sett_v, float) and math.isnan(sett_v))) else None,
        })

    return [e for e in events if e["sku_platform_name"]]


# ── Build pricing lookup for order events ─────────────────────────────────────

async def _build_sku_lookup(session: AsyncSession, platform_id: int) -> dict[str, int]:
    """Return map: sku_platform_name.upper() → sku_pricing_id."""
    result = await session.execute(
        select(SkuPlatformConfig).where(
            SkuPlatformConfig.platform_id == platform_id,
            SkuPlatformConfig.platform_sku_name.isnot(None),
        )
    )
    configs = result.scalars().all()
    return {
        c.platform_sku_name.strip().upper(): c.sku_pricing_id
        for c in configs
        if c.platform_sku_name and c.sku_pricing_id
    }


# ── Store order events ────────────────────────────────────────────────────────

async def store_order_events(
    session: AsyncSession,
    events: list[dict],
    report_id: int,
    platform_id: int,
) -> int:
    """Persist order events. Returns count stored."""
    if not events:
        return 0

    sku_lookup = await _build_sku_lookup(session, platform_id)

    for ev in events:
        pricing_id = sku_lookup.get(ev["sku_platform_name"].upper())
        obj = OrderEvent(
            report_id=report_id,
            platform_id=platform_id,
            sku_pricing_id=pricing_id,
            external_order_id=ev.get("external_order_id"),
            sku_platform_name=ev["sku_platform_name"],
            order_date=ev.get("order_date"),
            order_status=ev["order_status"],
            payment_mode=ev.get("payment_mode"),
            sale_amount=ev.get("sale_amount"),
            settled_amount=ev.get("settled_amount"),
        )
        session.add(obj)

    return len(events)


# ── Intelligence Engine ───────────────────────────────────────────────────────

def _risk_tier(z_score: Optional[float], combined_loss_rate: Optional[float]) -> str:
    """
    Classify risk tier using Z-score + absolute loss rate.
    Z-score measures how far above platform average this SKU is.
    combined_loss_rate = (returned + rto) / gross
    """
    z  = z_score or 0.0
    cr = combined_loss_rate or 0.0

    if z >= 2.0 or cr >= 0.50:
        return "CRITICAL"
    if z >= 1.0 or cr >= 0.35:
        return "RED"
    if z >= 0.5 or cr >= 0.20:
        return "AMBER"
    return "GREEN"


def _trend(current_rate: float, prev_rate: Optional[float]) -> str:
    if prev_rate is None:
        return "STABLE"
    delta = current_rate - prev_rate
    if delta > 0.05:
        return "WORSENING"
    if delta < -0.05:
        return "IMPROVING"
    return "STABLE"


async def compute_sku_risk_scores(session: AsyncSession, platform_id: int) -> int:
    """
    Recompute all SkuRiskScore rows for a platform after an upload.
    1. Pull all order_events for this platform
    2. Group by sku_platform_name
    3. Compute rates + Z-score + risk tier
    4. Delete old scores + insert fresh ones
    Returns count of SKUs scored.
    """
    # Pull all events for this platform
    result = await session.execute(
        select(OrderEvent).where(OrderEvent.platform_id == platform_id)
    )
    events = result.scalars().all()

    if not events:
        return 0

    # Group by SKU
    from collections import defaultdict
    sku_events: dict[str, list[OrderEvent]] = defaultdict(list)
    for ev in events:
        sku_events[ev.sku_platform_name].append(ev)

    # Compute per-SKU stats
    stats: list[dict] = []
    for sku_name, evs in sku_events.items():
        gross         = len(evs)
        delivered     = sum(1 for e in evs if e.order_status == "DELIVERED")
        returned      = sum(1 for e in evs if e.order_status == "RETURNED")
        rto           = sum(1 for e in evs if e.order_status == "RTO")
        cancelled     = sum(1 for e in evs if e.order_status == "CANCELLED")
        pending_ret   = sum(1 for e in evs if e.order_status == "PENDING_RETURN")
        in_transit    = sum(1 for e in evs if e.order_status == "IN_TRANSIT")

        # Rates (denominator = gross excluding cancelled — cancelled aren't shipped)
        denom = gross - cancelled
        return_rate  = round(returned / denom, 4) if denom > 0 else 0.0
        rto_rate     = round(rto / denom, 4)      if denom > 0 else 0.0
        canc_rate    = round(cancelled / gross, 4) if gross > 0 else 0.0
        combined     = round((returned + rto) / denom, 4) if denom > 0 else 0.0

        # Payment mode split (FK has prepaid/postpaid; others mostly prepaid)
        prepaid_evs  = [e for e in evs if e.payment_mode == "prepaid" and e.order_status in ("DELIVERED", "RETURNED", "RTO", "PENDING_RETURN")]
        postpaid_evs = [e for e in evs if e.payment_mode == "postpaid" and e.order_status in ("DELIVERED", "RETURNED", "RTO", "PENDING_RETURN")]

        def _payment_return_rate(pay_evs):
            if not pay_evs:
                return None
            pay_denom = len(pay_evs) - sum(1 for e in pay_evs if e.order_status == "CANCELLED")
            if pay_denom <= 0:
                return None
            return round(sum(1 for e in pay_evs if e.order_status in ("RETURNED", "RTO")) / pay_denom, 4)

        prepaid_rr  = _payment_return_rate(prepaid_evs)
        postpaid_rr = _payment_return_rate(postpaid_evs)
        cod_abuse   = bool(
            prepaid_rr is not None and postpaid_rr is not None
            and (postpaid_rr - prepaid_rr) > 0.20
        )

        # Revenue
        sale_amounts = [e.sale_amount for e in evs if e.sale_amount is not None and e.sale_amount > 0]
        avg_sale     = round(sum(sale_amounts) / len(sale_amounts), 2) if sale_amounts else None
        total_rev    = round(sum(sale_amounts), 2) if sale_amounts else None
        rev_at_risk  = round(pending_ret * avg_sale, 2) if (avg_sale and pending_ret > 0) else 0.0

        # Pricing ID (use first matched event's)
        pricing_id   = next((e.sku_pricing_id for e in evs if e.sku_pricing_id), None)

        stats.append({
            "sku_platform_name": sku_name,
            "sku_pricing_id":    pricing_id,
            "gross_orders":      gross,
            "delivered_orders":  delivered,
            "returned_orders":   returned,
            "rto_orders":        rto,
            "cancelled_orders":  cancelled,
            "pending_return_orders": pending_ret,
            "in_transit_orders": in_transit,
            "return_rate":       return_rate,
            "rto_rate":          rto_rate,
            "cancellation_rate": canc_rate,
            "combined_loss_rate": combined,
            "prepaid_return_rate": prepaid_rr,
            "postpaid_return_rate": postpaid_rr,
            "cod_abuse_flag":    cod_abuse,
            "avg_sale_amount":   avg_sale,
            "total_revenue":     total_rev,
            "revenue_at_risk":   rev_at_risk,
        })

    # Platform-level statistics for Z-score
    loss_rates = [s["combined_loss_rate"] for s in stats if s["gross_orders"] >= 3]
    if len(loss_rates) >= 2:
        avg  = sum(loss_rates) / len(loss_rates)
        std  = math.sqrt(sum((x - avg) ** 2 for x in loss_rates) / len(loss_rates))
    else:
        avg = sum(loss_rates) / len(loss_rates) if loss_rates else 0.0
        std = 0.0

    # Delete old scores for this platform
    await session.execute(
        delete(SkuRiskScore).where(SkuRiskScore.platform_id == platform_id)
    )

    # Insert fresh scores
    now = datetime.utcnow()
    for s in stats:
        clr   = s["combined_loss_rate"]
        z     = round((clr - avg) / std, 3) if std > 0 else 0.0
        tier  = _risk_tier(z, clr)

        session.add(SkuRiskScore(
            sku_pricing_id=s["sku_pricing_id"],
            platform_id=platform_id,
            sku_platform_name=s["sku_platform_name"],
            computed_at=now,
            gross_orders=s["gross_orders"],
            delivered_orders=s["delivered_orders"],
            returned_orders=s["returned_orders"],
            rto_orders=s["rto_orders"],
            cancelled_orders=s["cancelled_orders"],
            pending_return_orders=s["pending_return_orders"],
            in_transit_orders=s["in_transit_orders"],
            return_rate=s["return_rate"],
            rto_rate=s["rto_rate"],
            cancellation_rate=s["cancellation_rate"],
            combined_loss_rate=clr,
            platform_avg_return_rate=round(avg, 4),
            platform_std_return_rate=round(std, 4),
            z_score=z,
            risk_tier=tier,
            prepaid_return_rate=s["prepaid_return_rate"],
            postpaid_return_rate=s["postpaid_return_rate"],
            cod_abuse_flag=s["cod_abuse_flag"],
            avg_sale_amount=s["avg_sale_amount"],
            total_revenue=s["total_revenue"],
            revenue_at_risk=s["revenue_at_risk"],
            trend_direction="STABLE",  # TODO: compute from historical when 2+ months exist
        ))

    return len(stats)


# ── Dashboard aggregates ──────────────────────────────────────────────────────

async def get_fraud_dashboard(session: AsyncSession) -> dict:
    """Aggregated risk view across all platforms."""
    # Risk tier distribution
    tier_result = await session.execute(
        select(SkuRiskScore.risk_tier, func.count(SkuRiskScore.id))
        .group_by(SkuRiskScore.risk_tier)
    )
    tier_counts = {row[0]: row[1] for row in tier_result}

    # Total revenue at risk
    rev_result = await session.execute(
        select(func.sum(SkuRiskScore.revenue_at_risk))
    )
    total_rev_at_risk = float(rev_result.scalar() or 0)

    # Pending returns count
    pending_result = await session.execute(
        select(func.sum(SkuRiskScore.pending_return_orders))
    )
    total_pending = int(pending_result.scalar() or 0)

    # COD abuse count
    cod_result = await session.execute(
        select(func.count(SkuRiskScore.id))
        .where(SkuRiskScore.cod_abuse_flag == True)
    )
    cod_abuse_count = int(cod_result.scalar() or 0)

    # All risk scores for table
    scores_result = await session.execute(
        select(SkuRiskScore, Platform.name.label("platform_name"))
        .join(Platform, SkuRiskScore.platform_id == Platform.id)
        .order_by(SkuRiskScore.z_score.desc().nullslast(), SkuRiskScore.combined_loss_rate.desc().nullslast())
    )
    scores_rows = scores_result.all()
    sku_table = [
        {
            "id":                  s.id,
            "sku_platform_name":   s.sku_platform_name,
            "platform_name":       pname,
            "risk_tier":           s.risk_tier,
            "z_score":             s.z_score,
            "combined_loss_rate":  s.combined_loss_rate,
            "return_rate":         s.return_rate,
            "rto_rate":            s.rto_rate,
            "cancellation_rate":   s.cancellation_rate,
            "gross_orders":        s.gross_orders,
            "returned_orders":     s.returned_orders,
            "rto_orders":          s.rto_orders,
            "pending_return_orders": s.pending_return_orders,
            "cod_abuse_flag":      s.cod_abuse_flag,
            "prepaid_return_rate": s.prepaid_return_rate,
            "postpaid_return_rate": s.postpaid_return_rate,
            "revenue_at_risk":     s.revenue_at_risk,
            "total_revenue":       s.total_revenue,
            "avg_sale_amount":     s.avg_sale_amount,
            "trend_direction":     s.trend_direction,
            "platform_avg_return_rate": s.platform_avg_return_rate,
        }
        for s, pname in scores_rows
    ]

    # Temporal: weekly return rate (all platforms combined)
    week_result = await session.execute(
        text("""
            SELECT
                strftime('%Y-W%W', order_date) AS week,
                COUNT(CASE WHEN order_status IN ('RETURNED','RTO','PENDING_RETURN') THEN 1 END) AS losses,
                COUNT(CASE WHEN order_status NOT IN ('CANCELLED','IN_TRANSIT') THEN 1 END) AS shipped,
                COUNT(*) AS total
            FROM order_events
            WHERE order_date IS NOT NULL
            GROUP BY week
            ORDER BY week
        """)
    )
    weekly_data = [
        {
            "week":        row[0],
            "losses":      row[1],
            "shipped":     row[2],
            "total":       row[3],
            "loss_rate":   round(row[1] / row[2], 4) if row[2] > 0 else 0.0,
        }
        for row in week_result
    ]

    # Cross-platform comparison: same sku_pricing_id across multiple platforms
    cross_result = await session.execute(
        select(
            SkuRiskScore.sku_pricing_id,
            SkuRiskScore.sku_platform_name,
            Platform.name.label("platform_name"),
            SkuRiskScore.combined_loss_rate,
            SkuRiskScore.risk_tier,
            SkuRiskScore.gross_orders,
        )
        .join(Platform, SkuRiskScore.platform_id == Platform.id)
        .where(SkuRiskScore.sku_pricing_id.isnot(None))
        .order_by(SkuRiskScore.sku_pricing_id, SkuRiskScore.combined_loss_rate.desc().nullslast())
    )
    cross_rows = cross_result.all()

    # Group by sku_pricing_id
    from collections import defaultdict
    cross_map: dict = defaultdict(list)
    for row in cross_rows:
        cross_map[row.sku_pricing_id].append({
            "platform_name":      row.platform_name,
            "sku_platform_name":  row.sku_platform_name,
            "combined_loss_rate": row.combined_loss_rate,
            "risk_tier":          row.risk_tier,
            "gross_orders":       row.gross_orders,
        })
    # Only include SKUs present on 2+ platforms
    cross_platform = [
        {"sku_pricing_id": k, "platforms": v}
        for k, v in cross_map.items()
        if len(v) >= 2
    ]

    return {
        "tier_summary": {
            "CRITICAL": tier_counts.get("CRITICAL", 0),
            "RED":       tier_counts.get("RED", 0),
            "AMBER":     tier_counts.get("AMBER", 0),
            "GREEN":     tier_counts.get("GREEN", 0),
        },
        "total_revenue_at_risk": total_rev_at_risk,
        "total_pending_returns": total_pending,
        "cod_abuse_skus":        cod_abuse_count,
        "sku_risk_table":        sku_table,
        "weekly_loss_trend":     weekly_data,
        "cross_platform":        cross_platform,
    }
