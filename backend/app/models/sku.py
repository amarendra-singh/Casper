from app.core.time import utcnow
from datetime import datetime
from sqlalchemy import and_, String, Float, Boolean, DateTime, Integer, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from typing import Optional  # ← add this if not already there

class Sku(Base):
    __tablename__ = "skus"
    # A SKU code identifies a product within one seller, not across all of them.
    __table_args__ = (UniqueConstraint("company_id", "shringar_sku", name="uq_sku_company_code"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    shringar_sku: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    display_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    primary_image_url: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    vendor_sku: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    stock_item_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("stock_items.id", ondelete="RESTRICT", name="fk_skus_stock_item_id"), nullable=True)
    base_units_per_sku: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    vendor_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("vendors.id", ondelete="RESTRICT"), nullable=True)
    category_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("categories.id", ondelete="RESTRICT"), nullable=True)

    series: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    hsn_code_id: Mapped[int] = mapped_column(Integer, ForeignKey("hsn_codes.id"), nullable=True)
    gst_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    hsn_code: Mapped["HsnCode"] = relationship("HsnCode", lazy="joined")
    # Relationships
    vendor: Mapped["Vendor"] = relationship("Vendor", back_populates="skus")
    category: Mapped["Category"] = relationship("Category", back_populates="skus")
    pricing: Mapped[list["SkuPricing"]] = relationship("SkuPricing", back_populates="sku", cascade="all, delete-orphan")


class SkuPricing(Base):
    __tablename__ = "sku_pricing"
    # One cost row per SKU per platform. Without this, a re-anchored upsert can
    # insert a second row for the same pair and the grid silently reads one of them.
    __table_args__ = (UniqueConstraint("company_id", "sku_id", "platform_id", name="uq_pricing_company_sku_platform"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
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

    cr_cost_override: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    damage_cost_override: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    misc_total_override: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # ── Auto-calculated outputs ───────────────────────────
    breakeven: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    net_profit_amt: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    bs_wo_gst: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    bank_settlement: Mapped[float] = mapped_column(Float, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    # Relationships
    sku: Mapped["Sku"] = relationship("Sku", back_populates="pricing")
    platform: Mapped["Platform"] = relationship("Platform", back_populates="sku_pricing", primaryjoin="and_(SkuPricing.platform_id == Platform.id, SkuPricing.company_id == Platform.company_id)")
    platform_configs: Mapped[list["SkuPlatformConfig"]] = relationship(
        "SkuPlatformConfig", back_populates="sku_pricing", cascade="all, delete-orphan"
    )


class SkuPlatformConfig(Base):
    """Per-SKU-per-platform pricing overrides.
    None = inherit from Platform.default_ad_pct / default_profit_pct.
    """
    __tablename__ = "sku_platform_config"

    id:             Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id:     Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    sku_pricing_id: Mapped[int] = mapped_column(Integer, ForeignKey("sku_pricing.id", ondelete="CASCADE"), nullable=False)
    platform_id:    Mapped[int] = mapped_column(Integer, ForeignKey("platforms.id", ondelete="RESTRICT"), nullable=False)

    # None = inherit from platform default
    ad_pct:             Mapped[Optional[float]] = mapped_column(Float, nullable=True, comment="Override AD% for this SKU on this platform")
    profit_pct:         Mapped[Optional[float]] = mapped_column(Float, nullable=True, comment="Override profit% for this SKU on this platform")
    reverse_shipping_charge: Mapped[Optional[float]] = mapped_column(Float, nullable=True, comment="Override platform reverse-shipping charge per return")
    platform_sku_name:  Mapped[Optional[str]]   = mapped_column(String(250), nullable=True, comment="SKU name alias on this platform (e.g. Flipkart title)")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    # Relationships
    sku_pricing: Mapped["SkuPricing"] = relationship("SkuPricing", back_populates="platform_configs")
    platform:    Mapped["Platform"]   = relationship("Platform")


class SkuReverseShipping(Base):
    """SKU/platform return charge, independent of whether pricing exists yet."""
    __tablename__ = "sku_reverse_shipping"
    __table_args__ = (UniqueConstraint("company_id", "sku_id", "platform_id",
                                     name="uq_sku_reverse_shipping_scope"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    sku_id: Mapped[int] = mapped_column(Integer, ForeignKey("skus.id", ondelete="CASCADE"), nullable=False)
    platform_id: Mapped[int] = mapped_column(Integer, ForeignKey("platforms.id", ondelete="RESTRICT"), nullable=False)
    charge: Mapped[float] = mapped_column(Float, nullable=False)
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from app.models.hsn_code import HsnCode
    from app.models.vendor import Vendor
    from app.models.category import Category
    from app.models.platform import Platform
