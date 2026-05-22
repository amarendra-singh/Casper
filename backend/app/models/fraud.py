"""
Fraud Detection Models

OrderEvent     — one row per order from any platform upload.
SkuRiskScore   — computed risk intelligence per SKU per platform (recalculated on every upload).
"""

from datetime import datetime, date
from typing import Optional
from sqlalchemy import String, Float, Boolean, DateTime, Date, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class OrderEvent(Base):
    __tablename__ = "order_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    report_id: Mapped[int] = mapped_column(Integer, ForeignKey("pnl_reports.id", ondelete="CASCADE"), nullable=False)
    platform_id: Mapped[int] = mapped_column(Integer, ForeignKey("platforms.id"), nullable=False)
    sku_pricing_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("sku_pricing.id"), nullable=True)

    # Raw order identifiers
    external_order_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    sku_platform_name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Timing
    order_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Normalised status across all platforms:
    # DELIVERED | RETURNED | RTO | CANCELLED | PENDING_RETURN | IN_TRANSIT
    order_status: Mapped[str] = mapped_column(String(50), nullable=False)

    # Payment mode: prepaid | postpaid | cod | unknown
    payment_mode: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # Financials
    sale_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    settled_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Relationships
    report: Mapped["PnlReport"] = relationship("PnlReport")
    platform: Mapped["Platform"] = relationship("Platform")


class SkuRiskScore(Base):
    """
    Computed intelligence per SKU per platform.
    Fully replaced (delete + reinsert) after each upload.
    Z-score based — adapts as more data accumulates.
    """
    __tablename__ = "sku_risk_scores"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    sku_pricing_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("sku_pricing.id"), nullable=True)
    platform_id: Mapped[int] = mapped_column(Integer, ForeignKey("platforms.id"), nullable=False)
    sku_platform_name: Mapped[str] = mapped_column(String(255), nullable=False)
    computed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Raw counts
    gross_orders: Mapped[int] = mapped_column(Integer, default=0)
    delivered_orders: Mapped[int] = mapped_column(Integer, default=0)
    returned_orders: Mapped[int] = mapped_column(Integer, default=0)
    rto_orders: Mapped[int] = mapped_column(Integer, default=0)
    cancelled_orders: Mapped[int] = mapped_column(Integer, default=0)
    pending_return_orders: Mapped[int] = mapped_column(Integer, default=0)
    in_transit_orders: Mapped[int] = mapped_column(Integer, default=0)

    # Rates (0.0–1.0)
    return_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rto_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cancellation_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    combined_loss_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # returned + rto

    # Statistical outlier detection
    platform_avg_return_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    platform_std_return_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    z_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Risk classification: GREEN | AMBER | RED | CRITICAL
    risk_tier: Mapped[str] = mapped_column(String(20), default="GREEN")

    # Payment mode analysis (populated for FK only)
    prepaid_return_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    postpaid_return_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cod_abuse_flag: Mapped[bool] = mapped_column(Boolean, default=False)

    # Revenue intelligence
    avg_sale_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    total_revenue: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    revenue_at_risk: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # pending returns × avg price

    # Trend (positive = returns increasing, negative = improving)
    trend_direction: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # IMPROVING | STABLE | WORSENING

    # Relationships
    platform: Mapped["Platform"] = relationship("Platform")
