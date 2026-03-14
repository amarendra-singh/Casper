from datetime import datetime
from sqlalchemy import String, Float, Boolean, DateTime, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class Platform(Base):
    __tablename__ = "platforms"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    cr_charge: Mapped[float] = mapped_column(Float, nullable=False, comment="Flat customer return charge in INR")
    cr_percentage: Mapped[float] = mapped_column(Float, nullable=False, comment="Customer return % for reporting")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    tiers: Mapped[list["PlatformTier"]] = relationship("PlatformTier", back_populates="platform", cascade="all, delete-orphan")
    sku_pricing: Mapped[list["SkuPricing"]] = relationship("SkuPricing", back_populates="platform")


class PlatformTier(Base):
    __tablename__ = "platform_tiers"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    platform_id: Mapped[int] = mapped_column(Integer, ForeignKey("platforms.id", ondelete="CASCADE"), nullable=False)
    tier_name: Mapped[str] = mapped_column(String(50), nullable=False, comment="e.g. Gold, Silver, Bronze")
    fee: Mapped[float] = mapped_column(Float, nullable=False, comment="Flat fee in INR for this tier")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    platform: Mapped["Platform"] = relationship("Platform", back_populates="tiers")