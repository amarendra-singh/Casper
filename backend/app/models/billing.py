from datetime import datetime, date
from typing import Optional
from sqlalchemy import String, Float, Date, DateTime, Integer, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base

INVOICE_STATUSES = ["draft", "sent", "paid", "cancelled"]


class Invoice(Base):
    """
    A sales invoice (accounts receivable) — money the company bills a customer.
    Header + line items. `status` is stored; 'overdue' is derived at read time
    from due_date vs today when not yet paid/cancelled.
    """
    __tablename__ = "invoices"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("companies.id"), nullable=True, index=True)

    number: Mapped[str] = mapped_column(String(40), nullable=False)          # e.g. INV-2026-0001
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    due_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    customer_name: Mapped[str] = mapped_column(String(150), nullable=False)
    customer_gstin: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    status: Mapped[str] = mapped_column(String(12), nullable=False, default="draft")
    gst_pct: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    # Money (computed from lines on write; stored for fast reads)
    subtotal: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    tax_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    total: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    amount_paid: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    bank_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    lines: Mapped[list["InvoiceLine"]] = relationship(
        "InvoiceLine", back_populates="invoice", cascade="all, delete-orphan", order_by="InvoiceLine.id"
    )


class InvoiceLine(Base):
    __tablename__ = "invoice_lines"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    invoice_id: Mapped[int] = mapped_column(Integer, ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    sku_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("skus.id", ondelete="SET NULL"), nullable=True)
    quantity: Mapped[float] = mapped_column(Float, nullable=False, default=1)
    unit_price: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    amount: Mapped[float] = mapped_column(Float, nullable=False, default=0)  # quantity × unit_price

    invoice: Mapped["Invoice"] = relationship("Invoice", back_populates="lines")
