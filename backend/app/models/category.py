from datetime import datetime
from typing import Optional
from sqlalchemy import String, Boolean, DateTime, Float
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int | None] = mapped_column(nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Per-category defaults (cascade to new SKUs; per-SKU override allowed)
    default_cr_pct:     Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    default_damage_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    default_profit_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    skus: Mapped[list["Sku"]] = relationship("Sku", back_populates="category")