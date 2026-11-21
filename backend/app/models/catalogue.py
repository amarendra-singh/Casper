"""Product media, shared physical stock and approved base-unit costs."""
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.time import utcnow


class SkuImage(Base):
    __tablename__ = "sku_images"
    __table_args__ = (
        Index("uq_sku_primary_image", "company_id", "sku_id", unique=True,
              sqlite_where=text("is_primary = 1"), postgresql_where=text("is_primary = true")),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), nullable=False, index=True)
    sku_id: Mapped[int] = mapped_column(ForeignKey("skus.id", ondelete="CASCADE"), nullable=False, index=True)
    file_name: Mapped[str] = mapped_column(String(80), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(30), nullable=False)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    alt_text: Mapped[Optional[str]] = mapped_column(String(200))
    uploaded_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class StockItem(Base):
    __tablename__ = "stock_items"
    __table_args__ = (UniqueConstraint("company_id", "name", name="uq_stock_item_company_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    base_unit: Mapped[str] = mapped_column(String(30), nullable=False, default="piece")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class StockMovement(Base):
    __tablename__ = "stock_movements"
    __table_args__ = (
        UniqueConstraint("company_id", "request_key", name="uq_stock_movement_request"),
        UniqueConstraint("company_id", "reverses_id", name="uq_stock_movement_reversal"),
        Index("ix_stock_movement_item_date", "stock_item_id", "movement_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), nullable=False, index=True)
    stock_item_id: Mapped[int] = mapped_column(ForeignKey("stock_items.id", ondelete="RESTRICT"), nullable=False)
    sku_id: Mapped[Optional[int]] = mapped_column(ForeignKey("skus.id", ondelete="RESTRICT"))
    movement_date: Mapped[date] = mapped_column(Date, nullable=False)
    movement_type: Mapped[str] = mapped_column(String(24), nullable=False)
    base_units_delta: Mapped[int] = mapped_column(Integer, nullable=False)
    request_key: Mapped[str] = mapped_column(String(80), nullable=False)
    reverses_id: Mapped[Optional[int]] = mapped_column(ForeignKey("stock_movements.id", ondelete="RESTRICT"))
    reference_type: Mapped[Optional[str]] = mapped_column(String(30))
    reference_id: Mapped[Optional[int]] = mapped_column(Integer)
    reason: Mapped[Optional[str]] = mapped_column(Text)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class StockCost(Base):
    __tablename__ = "stock_costs"
    __table_args__ = (UniqueConstraint("company_id", "source_type", "source_id", name="uq_stock_cost_source"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), nullable=False, index=True)
    stock_item_id: Mapped[int] = mapped_column(ForeignKey("stock_items.id", ondelete="RESTRICT"), nullable=False)
    cost_per_base_unit: Mapped[float] = mapped_column(Float, nullable=False)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False)
    source_id: Mapped[Optional[int]] = mapped_column(Integer)
    effective_date: Mapped[date] = mapped_column(Date, nullable=False)
    note: Mapped[Optional[str]] = mapped_column(String(300))
    approved_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
