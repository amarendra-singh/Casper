from pydantic import BaseModel, validator
from typing import Optional, List

class EntryRowInput(BaseModel):
    # SKU fields
    shringar_sku:  str
    vendor_id:     Optional[int] = None
    category_id:   Optional[int] = None
    hsn_code_id:   Optional[int] = None
    description:   Optional[str] = None

    # Unit economics
    price:         float
    package:       Optional[float] = 0
    logistics:     Optional[float] = 0
    ad:            Optional[float] = 0
    addons:        Optional[float] = 0
    misc_total:    Optional[float] = None   # None = use global setting
    cr_percentage: Optional[float] = None   # None = use platform default
    cr_cost:       Optional[float] = None   # None = auto from cr_percentage
    damage_percentage: Optional[float] = None  # None = use global (15%)
    damage_cost:   Optional[float] = None   # None = auto from damage_percentage
    gst:           Optional[float] = 0

    # Profit override
    profit_percentage: Optional[float] = None  # None = use global (20%)

    @validator('shringar_sku')
    def sku_must_not_be_empty(cls, v):
        v = v.strip().upper()
        if not v:
            raise ValueError('Shringar SKU cannot be empty')
        return v

    @validator('price')
    def price_must_be_positive(cls, v):
        if v <= 0:
            raise ValueError('Price must be greater than 0')
        return v


class EntryRowResult(BaseModel):
    shringar_sku: str
    sku_id:       int
    success:      bool
    error:        Optional[str] = None

class EntryRowResponse(BaseModel):
    id:            int
    shringar_sku:  str
    vendor_id:     Optional[int] = None
    vendor_name:   Optional[str] = None
    vendor_short:  Optional[str] = None
    category_id:   Optional[int] = None
    category_name: Optional[str] = None
    hsn_code_id:   Optional[int] = None
    hsn_code:      Optional[str] = None
    gst_rate:      Optional[float] = None
    description:   Optional[str] = None
    price:         Optional[float] = None
    package:       Optional[float] = None
    logistics:     Optional[float] = None
    ad:            Optional[float] = None
    addons:        Optional[float] = None
    misc_total:    Optional[float] = None
    cr_percentage: Optional[float] = None
    cr_cost:       Optional[float] = None
    damage_percentage: Optional[float] = None
    damage_cost:   Optional[float] = None
    profit_percentage: Optional[float] = None
    gst:           Optional[float] = None
    breakeven:     Optional[float] = None
    bs_wo_gst:     Optional[float] = None
    bank_settlement: Optional[float] = None

    class Config:
        from_attributes = True


class UpsertBatchRequest(BaseModel):
    rows: List[EntryRowInput]

    @validator('rows')
    def rows_must_not_be_empty(cls, v):
        if not v:
            raise ValueError('At least one row is required')
        if len(v) > 500:
            raise ValueError('Maximum 500 rows per batch')
        return v


class UpsertBatchResponse(BaseModel):
    saved:  List[EntryRowResult]
    errors: List[EntryRowResult]
    total:  int
    saved_count:  int
    error_count:  int