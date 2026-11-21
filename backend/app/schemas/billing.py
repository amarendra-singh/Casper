from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel, field_validator, ConfigDict
from app.models.billing import INVOICE_STATUSES


class InvoiceLineIn(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    description: str
    sku_id: Optional[int] = None
    quantity: float = 1
    unit_price: float = 0

    @field_validator("quantity", "unit_price")
    @classmethod
    def _nonneg(cls, v):
        if v < 0:
            raise ValueError('Amount and quantity must be nonnegative')
        return round(float(v), 2)


class InvoiceLineOut(InvoiceLineIn):
    id: int
    amount: float
    model_config = {"from_attributes": True}


class InvoiceCreate(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    @field_validator('gst_pct', 'amount_paid')
    @classmethod
    def validate_amount(cls, value):
        if value is not None and value < 0:
            raise ValueError('Amount/rate must be nonnegative')
        return value

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
    @field_validator('number', 'invoice_date', 'customer_name', 'status', 'gst_pct', 'amount_paid', 'lines')
    @classmethod
    def required_when_present(cls, value):
        if value is None:
            raise ValueError('This field cannot be cleared')
        return value

    @field_validator('status')
    @classmethod
    def validate_status(cls, value):
        if value is not None and value not in INVOICE_STATUSES:
            raise ValueError('Invalid invoice status')
        return value

    model_config = ConfigDict(allow_inf_nan=False)

    @field_validator('gst_pct', 'amount_paid')
    @classmethod
    def validate_amount(cls, value):
        if value is not None and value < 0:
            raise ValueError('Amount/rate must be nonnegative')
        return value

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
    # Owning company — populated only when the scope spans several companies,
    # so a consolidated list can show whose record each row is.
    company_id:    Optional[int] = None
    company_name:  Optional[str] = None
    company_color: Optional[str] = None
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
