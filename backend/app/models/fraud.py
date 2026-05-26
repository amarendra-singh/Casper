"""
Fraud Detection Models

OrderEvent     — one row per order from any platform upload.
SkuRiskScore   — computed risk intelligence per SKU per platform (recalculated on every upload).
FraudAlert     — specific actionable alert with evidence, generated after each upload.
"""

from datetime import datetime, date
from typing import Optional
from sqlalchemy import String, Float, Boolean, DateTime, Date, Integer, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class OrderEvent(Base):
    __tablename__ = "order_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    report_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("pnl_reports.id", ondelete="CASCADE"), nullable=True)
    platform_id: Mapped[int] = mapped_column(Integer, ForeignKey("platforms.id"), nullable=False)
    sku_pricing_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("sku_pricing.id"), nullable=True)

    # Raw order identifiers
    external_order_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    sku_platform_name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Timing
    order_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    # Velocity dates (Snapdeal: del_date/RPU_date; Meesho: Dispatch Date/Payment Date proxy)
    dispatch_date:      Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    delivery_date:      Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    return_pickup_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    # Computed: (return_pickup_date - delivery_date).days — null if no delivery date
    return_velocity_days: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # Platform commission actually charged for this order (Snapdeal "Net Charged Fee")
    commission_charged: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Normalised status across all platforms:
    # DELIVERED | RETURNED | RTO | CANCELLED | PENDING_RETURN | IN_TRANSIT
    order_status: Mapped[str] = mapped_column(String(50), nullable=False)

    # Payment mode: prepaid | postpaid | cod | unknown
    payment_mode: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # Return intelligence (populated from FK Orders file + Snapdeal)
    return_reason:       Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    return_sub_reason:   Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    cancellation_reason: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    # FRAUD_SIGNAL | QUALITY | PREFERENCE | LOGISTICS | None
    fraud_signal_type:   Mapped[Optional[str]] = mapped_column(String(50),  nullable=True)

    # Geographic actor intelligence (populated from Snapdeal)
    customer_state_code: Mapped[Optional[str]] = mapped_column(String(10),  nullable=True)
    customer_state_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Payment mode actor signal
    is_cod:              Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)

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
    # Velocity intelligence (null for FK — no delivery dates available)
    avg_return_velocity_days: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    velocity_fraud_count:     Mapped[Optional[int]]   = mapped_column(Integer, nullable=True)
    # Fee intelligence (Snapdeal only)
    fee_overcharge_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # Composite 0-100 fraud score combining all signals
    composite_fraud_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Relationships
    platform: Mapped["Platform"] = relationship("Platform")


class FraudAlert(Base):
    """
    Specific actionable fraud/risk alert with evidence.
    Generated by generate_fraud_alerts() after every upload.
    Types: SETTLEMENT_GAP | COD_ABUSE | RETURN_SPIKE | FEE_OVERCHARGE | CROSS_PLATFORM_RISK
    """
    __tablename__ = "fraud_alerts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    platform_id: Mapped[int] = mapped_column(Integer, ForeignKey("platforms.id"), nullable=False)
    report_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("pnl_reports.id", ondelete="CASCADE"), nullable=True)

    alert_type: Mapped[str] = mapped_column(String(50), nullable=False)
    severity: Mapped[str] = mapped_column(String(20), nullable=False)   # CRITICAL | HIGH | MEDIUM | LOW
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    evidence_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON blob

    sku_platform_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # ₹ impact
    is_resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    platform: Mapped["Platform"] = relationship("Platform")


class ReturnReasonCluster(Base):
    """
    Aggregated return reason intelligence per platform.
    Recalculated after every upload.
    fraud_signal_type: FRAUD_SIGNAL | QUALITY | PREFERENCE | LOGISTICS
    """
    __tablename__ = "return_reason_clusters"

    id:                Mapped[int]           = mapped_column(primary_key=True, autoincrement=True)
    platform_id:       Mapped[int]           = mapped_column(Integer, ForeignKey("platforms.id"), nullable=False)
    return_reason:     Mapped[str]           = mapped_column(String(255), nullable=False)
    return_sub_reason: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    fraud_signal_type: Mapped[str]           = mapped_column(String(50),  nullable=False)
    order_count:       Mapped[int]           = mapped_column(Integer, default=0)
    computed_at:       Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    platform: Mapped["Platform"] = relationship("Platform")


class StateRiskProfile(Base):
    """
    State-level fraud heatmap derived from Snapdeal Customer State codes.
    Z-score: how far this state's fraud_rate is from the national mean.
    risk_tier: GREEN | AMBER | RED | CRITICAL based on z_score thresholds.
    """
    __tablename__ = "state_risk_profiles"

    id:           Mapped[int]             = mapped_column(primary_key=True, autoincrement=True)
    state_code:   Mapped[str]             = mapped_column(String(10),  nullable=False)
    state_name:   Mapped[str]             = mapped_column(String(100), nullable=False)
    total_orders: Mapped[int]             = mapped_column(Integer, default=0)
    fraud_orders: Mapped[int]             = mapped_column(Integer, default=0)
    fraud_rate:   Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    avg_velocity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    risk_tier:    Mapped[str]             = mapped_column(String(20), default="GREEN")
    z_score:      Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    computed_at:  Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class ActorRiskProfile(Base):
    """
    Actor fingerprint: state + dominant return reason cluster = behavioural actor.
    actor_key: SHA-256 hash (16 chars) of (state_name + dominant_reason).
    actor_fraud_score 0-100:
      return_rate(0-25) + fraud_reason_rate(0-30) + velocity(0-25) + repeat_pattern(0-20)
    """
    __tablename__ = "actor_risk_profiles"

    id:                 Mapped[int]            = mapped_column(primary_key=True, autoincrement=True)
    actor_key:          Mapped[str]            = mapped_column(String(64), nullable=False, unique=True)
    state_name:         Mapped[Optional[str]]  = mapped_column(String(100), nullable=True)
    dominant_reason:    Mapped[Optional[str]]  = mapped_column(String(255), nullable=True)
    fraud_signal_type:  Mapped[Optional[str]]  = mapped_column(String(50),  nullable=True)
    total_orders:       Mapped[int]            = mapped_column(Integer, default=0)
    return_count:       Mapped[int]            = mapped_column(Integer, default=0)
    fraud_reason_count: Mapped[int]            = mapped_column(Integer, default=0)
    avg_velocity_days:  Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    actor_fraud_score:  Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    risk_tier:          Mapped[str]            = mapped_column(String(20), default="GREEN")
    computed_at:        Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
