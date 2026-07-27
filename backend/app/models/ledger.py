from datetime import datetime, date
from typing import Optional
from sqlalchemy import String, Float, Date, DateTime, Integer, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


# Controlled vocabularies (validated in the schema, kept here as the source of truth)
DIRECTIONS = ["expense", "income"]
EXPENSE_CATEGORIES = [
    "inventory", "logistics", "packaging", "ads", "salary", "rent",
    "utilities", "tax", "platform_fee", "refund", "misc",
]
INCOME_CATEGORIES = ["settlement", "sale", "refund_received", "other_income"]
PAYMENT_METHODS = ["bank_transfer", "upi", "cash", "card", "cheque", "other"]


class LedgerEntry(Base):
    """
    A single real-world billing / expense ledger line — money in or out.

    Company-scoped. `amount` is always stored positive; `direction` gives the
    sign (expense = out, income = in). A line can optionally link to a saved
    vendor and/or SKU; `party_name` preserves the counterparty name even if the
    vendor is later deleted.
    """
    __tablename__ = "ledger_entries"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("companies.id"), nullable=True, index=True)

    entry_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    direction: Mapped[str] = mapped_column(String(10), nullable=False, default="expense")  # expense | income
    category: Mapped[str] = mapped_column(String(40), nullable=False, default="misc")
    amount: Mapped[float] = mapped_column(Float, nullable=False)  # positive INR

    # Counterparty — a saved vendor (FK) and/or a free-text name
    vendor_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    party_name: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)

    # Optional linkage to a SKU
    sku_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("skus.id", ondelete="SET NULL"), nullable=True)

    # Payment detail
    bank_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    payment_method: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    reference_no: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # txn / invoice / cheque ref

    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
