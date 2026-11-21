from app.core.time import utcnow
from datetime import datetime, date
from typing import Optional

from sqlalchemy import (
    String, Float, Date, DateTime, Integer, Text, ForeignKey, UniqueConstraint, Index,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


# Where a bill came from. Kept here as the source of truth; validated in schemas.
BILL_SOURCES = ["vyapar_pdf", "manual", "csv"]
BILL_STATUSES = ["unpaid", "paid", "partial"]

# How a bill line got linked to a SKU. `alias` and `manual` are trustworthy;
# `suggested` is a name-overlap guess and must never drive money on its own.
MATCH_SOURCES = ["alias", "manual", "suggested", "none"]


class PurchaseBill(Base):
    """
    A supplier bill — what the business BOUGHT. The payable counterpart to
    `Invoice` (what the business bills customers).

    Company-scoped. `(company_id, vendor_id, ref_no)` is unique so re-uploading
    the same statement updates the existing bills instead of duplicating them —
    statements overlap by design, since each one covers a date range.
    """
    __tablename__ = "purchase_bills"
    __table_args__ = (
        UniqueConstraint("company_id", "supplier_key", "ref_no", name="uq_purchase_bill_supplier_ref"),
        Index("ix_purchase_bills_company_date", "company_id", "bill_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False, index=True)

    vendor_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True
    )
    # Preserved separately so the bill still reads correctly if the vendor row goes.
    party_name: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)

    supplier_key: Mapped[str] = mapped_column(String(180), nullable=False, default="unknown")
    ref_no: Mapped[str] = mapped_column(String(60), nullable=False)
    bill_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    txn_type: Mapped[str] = mapped_column(String(20), nullable=False, default="Sale")
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="unpaid")

    total: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    # Sum of the parsed lines. Stored rather than derived so a bill whose lines
    # do not reconcile to its printed total stays visible as a discrepancy.
    lines_total: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    source: Mapped[str] = mapped_column(String(20), nullable=False, default="vyapar_pdf")
    source_file: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # The expense line this bill posts into the general ledger. Bills are the
    # subsidiary record (itemised); the ledger entry is the single money line
    # that makes the bill show up in Expense Ledger totals. Held as a FK so a
    # re-uploaded statement updates its entry instead of posting a duplicate.
    ledger_entry_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("ledger_entries.id", ondelete="SET NULL"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )

    lines: Mapped[list["PurchaseBillLine"]] = relationship(
        back_populates="bill", cascade="all, delete-orphan", lazy="selectin",
    )

    @property
    def reconciles(self) -> bool:
        return abs((self.lines_total or 0) - (self.total or 0)) < 0.01


class PurchaseBillLine(Base):
    """
    One line of a supplier bill.

    `item_name` is the supplier's own wording — deliberately kept verbatim,
    because it is the key used to learn the SKU mapping (see VendorItemAlias).
    `sku_id` is the resolved link; `match_source` records how much to trust it.
    """
    __tablename__ = "purchase_bill_lines"
    __table_args__ = (
        Index("ix_purchase_bill_lines_sku", "sku_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    bill_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("purchase_bills.id", ondelete="CASCADE"), nullable=False, index=True
    )
    line_no: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    item_name: Mapped[str] = mapped_column(String(300), nullable=False)
    hsn_code: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    quantity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    unit: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    pieces_per_unit: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    price_unit: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    edited_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    sku_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("skus.id", ondelete="SET NULL"), nullable=True
    )
    match_source: Mapped[str] = mapped_column(String(12), nullable=False, default="none")

    # How many SKU units one billed unit represents (a "1 box" line that is really
    # a 6-pack has pack_multiple 6). Unit cost = price_unit / pack_multiple, and
    # it stays explicit rather than being inferred from the SKU code.
    pack_multiple: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)

    bill: Mapped["PurchaseBill"] = relationship(back_populates="lines")

    @property
    def unit_cost(self) -> Optional[float]:
        if self.price_unit is None or not self.pack_multiple:
            return None
        return round(self.price_unit / self.pack_multiple, 2)


class VendorItemAlias(Base):
    """
    A remembered mapping from a supplier's item wording to one of our SKUs.

    This is what makes matching improve over time: confirm "CELLO AMORE TUM 325
    ML" once and every future statement from that vendor resolves it exactly,
    instead of re-running a fuzzy guess each upload.
    """
    __tablename__ = "vendor_item_aliases"
    __table_args__ = (
        UniqueConstraint("company_id", "supplier_key", "item_name", name="uq_supplier_item_alias"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    vendor_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("vendors.id", ondelete="CASCADE"), nullable=True
    )

    item_name: Mapped[str] = mapped_column(String(300), nullable=False)
    supplier_key: Mapped[str] = mapped_column(String(180), nullable=False)
    sku_id: Mapped[int] = mapped_column(Integer, ForeignKey("skus.id", ondelete="CASCADE"), nullable=False)
    pack_multiple: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
