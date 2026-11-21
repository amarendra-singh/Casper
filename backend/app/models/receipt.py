from datetime import date
from sqlalchemy import ForeignKey, UniqueConstraint, String, Date, Float
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class InvoiceReceipt(Base):
    __tablename__ = 'invoice_receipts'
    __table_args__ = (UniqueConstraint('company_id', 'request_key', name='uq_receipt_request'),)
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey('companies.id'), nullable=False)
    invoice_id: Mapped[int] = mapped_column(ForeignKey('invoices.id', ondelete='RESTRICT'), nullable=False)
    ledger_entry_id: Mapped[int] = mapped_column(ForeignKey('ledger_entries.id', ondelete='RESTRICT'), nullable=False)
    reversal_entry_id: Mapped[int | None] = mapped_column(ForeignKey('ledger_entries.id', ondelete='RESTRICT'))
    receipt_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    request_key: Mapped[str] = mapped_column(String(80), nullable=False)
    payment_method: Mapped[str] = mapped_column(String(20), nullable=False)
    reference_no: Mapped[str | None] = mapped_column(String(100))
