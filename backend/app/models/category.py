from app.core.time import utcnow
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Boolean, DateTime, Float, Integer, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class Category(Base):
    __tablename__ = "categories"
    # Category names are unique WITHIN a company. A global unique index here
    # meant the second tenant to want "Whisky Glass" was refused.
    __table_args__ = (UniqueConstraint("company_id", "name", name="uq_category_company_name"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Per-category defaults (cascade to new SKUs; per-SKU override allowed)
    default_cr_pct:     Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    default_damage_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    default_profit_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    # Relationships
    skus: Mapped[list["Sku"]] = relationship("Sku", back_populates="category")
# Forward references avoid runtime import cycles between mapped models.
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from app.models.sku import Sku
