"""
Fraud Detection Routes

GET  /fraud/overview              — verdict card + top alerts + platform health
GET  /fraud/dashboard             — legacy full dashboard (sku table, temporal, cross-platform)
GET  /fraud/platform/{id}         — per-platform risk table + alerts
GET  /fraud/alerts                — all unresolved alerts (filterable by platform / severity)
GET  /fraud/settlement            — settlement reconciliation gaps across all reports
PATCH /fraud/resolve/{alert_id}   — mark a specific alert as resolved
GET  /fraud/sku-risk              — SKU risk table only (lightweight polling)
GET  /fraud/temporal              — weekly loss trend only
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.models.fraud import FraudAlert
from app.services.fraud import (
    get_fraud_dashboard,
    get_fraud_overview,
    get_platform_fraud_view,
    get_settlement_gaps,
)


router = APIRouter(prefix="/fraud", tags=["Fraud Detection"])


# ── Overview ──────────────────────────────────────────────────────────────────

@router.get("/overview")
async def fraud_overview(
    _current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Verdict card + top alerts + platform health summary."""
    return await get_fraud_overview(db)


# ── Per-platform view ─────────────────────────────────────────────────────────

@router.get("/platform/{platform_id}")
async def platform_fraud_view(
    platform_id: int,
    _current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Per-platform risk table, alert list, tier summary."""
    result = await get_platform_fraud_view(db, platform_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


# ── Alerts list ───────────────────────────────────────────────────────────────

@router.get("/alerts")
async def list_alerts(
    platform_id: int | None = Query(default=None),
    severity: str | None = Query(default=None),
    _current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    List unresolved alerts with optional filters.
    ?platform_id=1 → filter by platform
    ?severity=CRITICAL → filter by severity level
    """
    q = select(FraudAlert).where(FraudAlert.is_resolved == False)
    if platform_id:
        q = q.where(FraudAlert.platform_id == platform_id)
    if severity:
        q = q.where(FraudAlert.severity == severity.upper())
    q = q.order_by(FraudAlert.created_at.desc())

    result = await db.execute(q)
    alerts = result.scalars().all()

    return {
        "alerts": [
            {
                "id":                a.id,
                "platform_id":       a.platform_id,
                "report_id":         a.report_id,
                "alert_type":        a.alert_type,
                "severity":          a.severity,
                "title":             a.title,
                "body":              a.body,
                "evidence_json":     a.evidence_json,
                "sku_platform_name": a.sku_platform_name,
                "amount":            a.amount,
                "is_resolved":       a.is_resolved,
                "created_at":        a.created_at.isoformat(),
            }
            for a in alerts
        ],
        "total": len(alerts),
    }


# ── Settlement reconciliation ──────────────────────────────────────────────────

@router.get("/settlement")
async def settlement_gaps(
    _current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Settlement gap analysis across all P&L reports."""
    return await get_settlement_gaps(db)


# ── Resolve an alert ──────────────────────────────────────────────────────────

@router.patch("/resolve/{alert_id}")
async def resolve_alert(
    alert_id: int,
    _current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark a fraud alert as resolved."""
    alert = await db.get(FraudAlert, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.is_resolved = True
    await db.commit()
    return {"id": alert_id, "is_resolved": True}


# ── Legacy / lightweight endpoints ────────────────────────────────────────────

@router.get("/dashboard")
async def fraud_dashboard(
    _current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Full fraud detection dashboard (SKU table, temporal, cross-platform)."""
    return await get_fraud_dashboard(db)


@router.get("/sku-risk")
async def sku_risk_table(
    _current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """SKU risk scores only (lightweight)."""
    data = await get_fraud_dashboard(db)
    return {
        "tier_summary":   data["tier_summary"],
        "sku_risk_table": data["sku_risk_table"],
    }


@router.get("/temporal")
async def temporal_trend(
    _current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Weekly loss rate trend."""
    data = await get_fraud_dashboard(db)
    return {"weekly_loss_trend": data["weekly_loss_trend"]}
