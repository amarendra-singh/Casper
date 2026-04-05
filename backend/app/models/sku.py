from datetime import datetime
from sqlalchemy import String, Float, Boolean, DateTime, Integer, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from typing import Optional  # ← add this if not already there

class Sku(Base):
    __tablename__ = "skus"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shringar_sku: Mapped[str] = mapped_column(String(150), unique=True, nullable=False, index=True)
    vendor_sku: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    vendor_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("vendors.id", ondelete="RESTRICT"), nullable=True)
    category_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("categories.id", ondelete="RESTRICT"), nullable=True)

    description: Mapped[str] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    hsn_code_id: Mapped[int] = mapped_column(Integer, ForeignKey("hsn_codes.id"), nullable=True)
    hsn_code: Mapped["HsnCode"] = relationship("HsnCode", lazy="joined")
    # Relationships
    vendor: Mapped["Vendor"] = relationship("Vendor", back_populates="skus")
    category: Mapped["Category"] = relationship("Category", back_populates="skus")
    pricing: Mapped[list["SkuPricing"]] = relationship("SkuPricing", back_populates="sku", cascade="all, delete-orphan")


class SkuPricing(Base):
    __tablename__ = "sku_pricing"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    sku_id: Mapped[int] = mapped_column(Integer, ForeignKey("skus.id", ondelete="CASCADE"), nullable=False)
    platform_id: Mapped[int] = mapped_column(Integer, ForeignKey("platforms.id", ondelete="RESTRICT"), nullable=False)

    # ── Inputs ───────────────────────────────────────────
    price: Mapped[float] = mapped_column(Float, nullable=False)
    package: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    logistics: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    addons: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    misc_total: Mapped[float] = mapped_column(Float, nullable=False, default=0, comment="Sum of misc items, overridable")
    gst: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    profit_percentage: Mapped[float] = mapped_column(Float, nullable=False, default=20)

    # ── CR (Customer Return) ──────────────────────────────
    cr_percentage: Mapped[float] = mapped_column(Float, nullable=False, comment="From platform, overridable")
    cr_cost: Mapped[float] = mapped_column(Float, nullable=False, comment="platform.cr_charge x cr_percentage, overridable")

    # ── Damage ───────────────────────────────────────────
    damage_percentage: Mapped[float] = mapped_column(Float, nullable=False, comment="From global settings, overridable")
    damage_cost: Mapped[float] = mapped_column(Float, nullable=False, comment="price x damage_percentage, overridable")

    # ── Auto-calculated outputs ───────────────────────────
    breakeven: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    net_profit_20: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    bs_wo_gst: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    bank_settlement: Mapped[float] = mapped_column(Float, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    sku: Mapped["Sku"] = relationship("Sku", back_populates="pricing")
    platform: Mapped["Platform"] = relationship("Platform", back_populates="sku_pricing")
    platform_configs: Mapped[list["SkuPlatformConfig"]] = relationship(
        "SkuPlatformConfig", back_populates="sku_pricing", cascade="all, delete-orphan"
    )


class SkuPlatformConfig(Base):
    """Per-SKU-per-platform AD and profit overrides.
    None = inherit from Platform.default_ad_pct / default_profit_pct.
    """
    __tablename__ = "sku_platform_config"

    id:             Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    sku_pricing_id: Mapped[int] = mapped_column(Integer, ForeignKey("sku_pricing.id", ondelete="CASCADE"), nullable=False)
    platform_id:    Mapped[int] = mapped_column(Integer, ForeignKey("platforms.id", ondelete="RESTRICT"), nullable=False)

    # None = inherit from platform default
    ad_pct:     Mapped[Optional[float]] = mapped_column(Float, nullable=True, comment="Override AD% for this SKU on this platform")
    profit_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True, comment="Override profit% for this SKU on this platform")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    sku_pricing: Mapped["SkuPricing"] = relationship("SkuPricing", back_populates="platform_configs")
    platform:    Mapped["Platform"]   = relationship("Platform")