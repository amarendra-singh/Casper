from app.core.time import utcnow
from datetime import datetime
from sqlalchemy import String, Float, Boolean, DateTime, Integer, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class Platform(Base):
    __tablename__ = "platforms"
    __table_args__ = (UniqueConstraint("company_id", "name", name="uq_platform_company_name"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)  # per-company; not globally unique
    cr_charge: Mapped[float] = mapped_column(Float, nullable=False, comment="Flat customer return charge in INR")
    cr_percentage: Mapped[float] = mapped_column(Float, nullable=False, comment="Customer return % for reporting")
    default_ad_pct: Mapped[float] = mapped_column(Float, nullable=False, default=0.0, comment="Default AD % of selling price for this platform")
    default_profit_pct: Mapped[float] = mapped_column(Float, nullable=False, default=20.0, comment="Default profit % for this platform")
    target_monthly_units: Mapped[int] = mapped_column(Integer, nullable=False, default=700, comment="Volume goal per month — used for True P&L absorption variance")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    # Relationships
    tiers: Mapped[list["PlatformTier"]] = relationship("PlatformTier", back_populates="platform", cascade="all, delete-orphan")
    sku_pricing: Mapped[list["SkuPricing"]] = relationship("SkuPricing", back_populates="platform")


class PlatformTier(Base):
    __tablename__ = "platform_tiers"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    platform_id: Mapped[int] = mapped_column(Integer, ForeignKey("platforms.id", ondelete="CASCADE"), nullable=False)
    tier_name: Mapped[str] = mapped_column(String(50), nullable=False, comment="e.g. Gold, Silver, Bronze")
    fee: Mapped[float] = mapped_column(Float, nullable=False, comment="Flat fee in INR (used when fee_pct is null)")
    # Phase 5: dual-mode tier — either ₹ (fee) OR % (fee_pct). One is master.
    fee_pct: Mapped[float | None] = mapped_column(Float, nullable=True, comment="If set, tier fee = base × fee_pct/100; takes precedence over `fee`")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    # Relationships
    platform: Mapped["Platform"] = relationship("Platform", back_populates="tiers")
# Forward references avoid runtime import cycles between mapped models.
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from app.models.sku import SkuPricing
