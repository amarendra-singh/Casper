# BaseModel is Pydantic's base class — it gives us automatic 
# data validation, type checking, and JSON parsing for free.
from pydantic import BaseModel, field_validator
from typing import Optional
# Optional datetime for response models
from datetime import datetime
from app.schemas.hsn_code import HsnCodeResponse


# ── SKU Schemas ───────────────────────────────────────────

class SkuCreate(BaseModel):
    # str = must be a string, FastAPI will reject if not
    shringar_sku: str        # your internal unique SKU code
    vendor_sku: str          # vendor's own SKU code
    vendor_id: int           # foreign key — which vendor
    category_id: int         # foreign key — which category
    hsn_code_id: Optional[int] = None
    description: str | None = None  # optional field, defaults to None

    # field_validator lets us run custom logic on a field before saving
    # 'shringar_sku' = which field to validate
    # mode='before' = run this BEFORE pydantic's own type checking
    @field_validator('shringar_sku', mode='before')
    @classmethod
    def uppercase_sku(cls, v: str) -> str:
        # strip() removes leading/trailing spaces
        # upper() converts to uppercase — keeps SKUs consistent
        return v.strip().upper()


class SkuUpdate(BaseModel):
    # All fields are optional (None by default) so user can 
    # update just one field without sending all fields
    vendor_sku: str | None = None
    category_id: int | None = None
    description: str | None = None
    is_active: bool | None = None


class SkuResponse(BaseModel):
    id: int
    shringar_sku: str
    vendor_sku:  Optional[str] = None
    vendor_id:   Optional[int] = None
    category_id: Optional[int] = None
    description: str | None
    is_active: bool
    created_at: datetime
    hsn_code_id: Optional[int] = None
    hsn_code: Optional[HsnCodeResponse] = None  # or HsnCodeResponse if imported

    # from_attributes=True tells Pydantic to read data from 
    # SQLAlchemy model attributes instead of a plain dict
    model_config = {"from_attributes": True}


# ── Pricing Schemas ───────────────────────────────────────

class PricingCreate(BaseModel):
    sku_id: int
    platform_id: int

    # All cost inputs
    price: float
    package: float = 0.0
    logistics: float = 0.0
    addons: float = 0.0
    gst: float = 0.0

    # misc_total: if not provided, app will auto-sum active misc items
    # None means "not provided yet"
    misc_total: float | None = None

    # CR fields — if not provided, pulled from platform defaults
    cr_percentage: float | None = None   # pulled from platform if None
    cr_cost: float | None = None         # auto = cr_charge × cr_percentage, overridable

    # Damage fields — if not provided, pulled from global settings
    damage_percentage: float | None = None  # pulled from global settings if None
    damage_cost: float | None = None        # auto = price × damage_percentage, overridable


class PricingUpdate(BaseModel):
    # Every field optional — user can update just price, 
    # and all calculations will recompute automatically
    price: float | None = None
    package: float | None = None
    logistics: float | None = None
    addons: float | None = None
    gst: float | None = None
    misc_total: float | None = None
    cr_percentage: float | None = None
    cr_cost: float | None = None
    damage_percentage: float | None = None
    damage_cost: float | None = None


class PricingResponse(BaseModel):
    id: int
    sku_id: int
    platform_id: int

    # Inputs
    price: float
    package: float
    logistics: float
    addons: float
    misc_total: float
    gst: float
    cr_percentage: float
    cr_cost: float
    damage_percentage: float
    damage_cost: float

    # Auto-calculated outputs
    breakeven: float
    net_profit_20: float
    bs_wo_gst: float
    bank_settlement: float

    created_at: datetime

    model_config = {"from_attributes": True}