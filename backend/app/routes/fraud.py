"""
Fraud Detection Routes

GET /fraud/dashboard   — full risk dashboard (tier summary, SKU table, temporal, cross-platform)
GET /fraud/sku-risk    — SKU risk table only (for lightweight polling)
GET /fraud/temporal    — weekly loss trend only
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.services.fraud import get_fraud_dashboard


router = APIRouter(prefix="/fraud", tags=["Fraud Detection"])


@router.get("/dashboard")
async def fraud_dashboard(
    _current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Full fraud detection dashboard data."""
    return await get_fraud_dashboard(db)


@router.get("/sku-risk")
async def sku_risk_table(
    _current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """SKU risk scores only (lightweight)."""
    data = await get_fraud_dashboard(db)
    return {
        "tier_summary":    data["tier_summary"],
        "sku_risk_table":  data["sku_risk_table"],
    }


@router.get("/temporal")
async def temporal_trend(
    _current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Weekly loss rate trend."""
    data = await get_fraud_dashboard(db)
    return {"weekly_loss_trend": data["weekly_loss_trend"]}
