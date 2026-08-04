from datetime import datetime, date
from typing import Optional
from sqlalchemy import String, Float, Boolean, DateTime, Date, Integer, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class PnlReport(Base):
    __tablename__ = "pnl_reports"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int | None] = mapped_column(nullable=True, index=True)
    platform_id: Mapped[int] = mapped_column(Integer, ForeignKey("platforms.id"), nullable=False)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    uploaded_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    status: Mapped[str] = mapped_column(String(20), default="done")  # processing | done | error

    # Summary totals (from Sheet 1)
    gross_sales: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    gross_units: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    returns_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    returned_units: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    net_sales: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    net_units: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    total_expenses: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    bank_settlement: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    input_tax_credits: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    net_earnings: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    net_margin_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    amount_settled: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    amount_pending: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # ── Snapdeal-specific fields (null for other platforms) ──────────────────
    seller_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    seller_code: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    gross_orders: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    return_orders: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    net_orders: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    cod_orders: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    ncod_orders: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    marketing_fee: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    courier_fee: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    payment_collection_fee: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    commission_total: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    tcs_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    tds_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    opening_balance: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    closing_balance: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Relationships
    platform: Mapped["Platform"] = relationship("Platform")
    uploader: Mapped["User"] = relationship("User")
    sku_rows: Mapped[list["PnlSkuRow"]] = relationship("PnlSkuRow", back_populates="report", cascade="all, delete-orphan")


class PnlSkuRow(Base):
    __tablename__ = "pnl_sku_rows"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int | None] = mapped_column(nullable=True, index=True)
    report_id: Mapped[int] = mapped_column(Integer, ForeignKey("pnl_reports.id", ondelete="CASCADE"), nullable=False)

    # Raw from Flipkart
    platform_sku_name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Matched to Casper (nullable — unmatched SKUs stored with null)
    sku_pricing_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("sku_pricing.id"), nullable=True)

    # Units
    gross_units: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    rto_units: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)       # Logistics return
    rvp_units: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)       # Customer return
    cancelled_units: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    net_units: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Flipkart actuals (INR)
    accounted_net_sales: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    commission_fee: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    collection_fee: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    fixed_fee: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    reverse_shipping_fee: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    taxes_gst: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    taxes_tcs: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    taxes_tds: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rewards_benefits: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    bank_settlement_projected: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    input_tax_credits: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    net_earnings: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    earnings_per_unit: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    net_margin_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    amount_settled: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    amount_pending: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # ── Frozen cost snapshot (captured at upload; null = uploaded before this
    # feature existed → engines fall back to live pricing and flag "estimated").
    # Closed periods must not move when SKU pricing is edited later.
    snap_cogs_per_unit: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    snap_fulfillment_per_unit: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    snap_return_per_unit: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    snap_overhead_per_unit: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    snap_breakeven: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    snap_gst: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Casper snapshot (frozen at upload time — null if unmatched)
    casper_expected_bs: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    casper_expected_profit_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    variance_bs: Mapped[Optional[float]] = mapped_column(Float, nullable=True)       # actual - expected
    variance_margin_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Relationships
    report: Mapped["PnlReport"] = relationship("PnlReport", back_populates="sku_rows")
    sku_pricing: Mapped[Optional["SkuPricing"]] = relationship("SkuPricing")

    @property
    def cogs(self) -> Optional[float]:
        """Purchase cost per unit from sku_pricing.price — the real COGS."""
        return self.sku_pricing.price if self.sku_pricing else None
