from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel, field_validator
from app.models.billing import INVOICE_STATUSES


class InvoiceLineIn(BaseModel):
    description: str
    sku_id: Optional[int] = None
    quantity: float = 1
    unit_price: float = 0

    @field_validator("quantity", "unit_price")
    @classmethod
    def _nonneg(cls, v):
        return round(float(v or 0), 2)


class InvoiceLineOut(InvoiceLineIn):
    id: int
    amount: float
    model_config = {"from_attributes": True}


class InvoiceCreate(BaseModel):
    number: Optional[str] = None       # auto-generated if omitted
    invoice_date: date
    due_date: Optional[date] = None
    customer_name: str
    customer_gstin: Optional[str] = None
    status: str = "draft"
    gst_pct: float = 0.0
    amount_paid: float = 0.0
    bank_name: Optional[str] = None
    notes: Optional[str] = None
    lines: list[InvoiceLineIn] = []

    @field_validator("status")
    @classmethod
    def _status(cls, v):
        if v not in INVOICE_STATUSES:
            raise ValueError(f"status must be one of {INVOICE_STATUSES}")
        return v


class InvoiceUpdate(BaseModel):
    number: Optional[str] = None
    invoice_date: Optional[date] = None
    due_date: Optional[date] = None
    customer_name: Optional[str] = None
    customer_gstin: Optional[str] = None
    status: Optional[str] = None
    gst_pct: Optional[float] = None
    amount_paid: Optional[float] = None
    bank_name: Optional[str] = None
    notes: Optional[str] = None
    lines: Optional[list[InvoiceLineIn]] = None   # if provided, replaces all lines


class InvoiceResponse(BaseModel):
    id: int
    number: str
    invoice_date: date
    due_date: Optional[date]
    customer_name: str
    customer_gstin: Optional[str]
    status: str            # stored status, or 'overdue' derived
    gst_pct: float
    subtotal: float
    tax_amount: float
    total: float
    amount_paid: float
    balance: float
    bank_name: Optional[str]
    notes: Optional[str]
    lines: list[InvoiceLineOut]
    created_at: datetime

    model_config = {"from_attributes": True}


class InvoiceSummary(BaseModel):
    total_invoiced: float
    total_paid: float
    outstanding: float
    overdue: float
    count: int
    by_status: list[dict]          # [{status, count, total}]
    aging: dict                    # {"0-30": x, "31-60": y, "60+": z}
