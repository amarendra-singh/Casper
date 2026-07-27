from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel, field_validator
from app.models.ledger import DIRECTIONS, PAYMENT_METHODS


class LedgerEntryBase(BaseModel):
    entry_date: date
    direction: str = "expense"
    category: str = "misc"
    amount: float
    vendor_id: Optional[int] = None
    party_name: Optional[str] = None
    sku_id: Optional[int] = None
    bank_name: Optional[str] = None
    payment_method: Optional[str] = None
    reference_no: Optional[str] = None
    note: Optional[str] = None

    @field_validator("direction")
    @classmethod
    def _dir(cls, v):
        if v not in DIRECTIONS:
            raise ValueError(f"direction must be one of {DIRECTIONS}")
        return v

    @field_validator("payment_method")
    @classmethod
    def _pm(cls, v):
        if v not in (None, "") and v not in PAYMENT_METHODS:
            raise ValueError(f"payment_method must be one of {PAYMENT_METHODS}")
        return v or None

    @field_validator("amount")
    @classmethod
    def _amt(cls, v):
        if v is None or v <= 0:
            raise ValueError("amount must be greater than 0")
        return round(float(v), 2)


class LedgerEntryCreate(LedgerEntryBase):
    pass


class LedgerEntryUpdate(BaseModel):
    entry_date: Optional[date] = None
    direction: Optional[str] = None
    category: Optional[str] = None
    amount: Optional[float] = None
    vendor_id: Optional[int] = None
    party_name: Optional[str] = None
    sku_id: Optional[int] = None
    bank_name: Optional[str] = None
    payment_method: Optional[str] = None
    reference_no: Optional[str] = None
    note: Optional[str] = None


class LedgerEntryResponse(LedgerEntryBase):
    id: int
    vendor_name: Optional[str] = None   # resolved for display
    sku_code: Optional[str] = None      # resolved for display
    created_at: datetime

    model_config = {"from_attributes": True}


class LedgerSummary(BaseModel):
    total_income: float
    total_expense: float
    net: float
    count: int
    by_category: list[dict]   # [{category, direction, total, count}]
