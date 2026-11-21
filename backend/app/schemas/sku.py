import math
# BaseModel is Pydantic's base class — it gives us automatic 
# data validation, type checking, and JSON parsing for free.
from pydantic import BaseModel, Field, field_validator
from typing import Optional
# Optional datetime for response models
from datetime import datetime
from app.schemas.hsn_code import HsnCodeResponse


# ── SKU Schemas ───────────────────────────────────────────

class SkuCreate(BaseModel):
    shringar_sku: str = Field(min_length=1, max_length=150)
    display_name: Optional[str] = Field(default=None, max_length=200)
    vendor_sku: Optional[str] = Field(default=None, max_length=150)
    vendor_id: Optional[int] = None
    category_id: Optional[int] = None
    hsn_code_id: Optional[int] = None
    description: str | None = None
    reverse_shipping_platform_id: int | None = None
    reverse_shipping_charge: float | None = Field(default=None, ge=0)

    @field_validator('reverse_shipping_charge')
    @classmethod
    def finite_reverse_shipping(cls, value):
        if value is not None and not math.isfinite(value):
            raise ValueError('Reverse shipping charge must be finite')
        return value

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
    company_id: Optional[int] = None  # nullable on the model — legacy pre-tenancy rows
    shringar_sku: str
    display_name: Optional[str] = None
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
    @field_validator('price', 'package', 'logistics', 'addons', 'misc_total', 'cr_percentage', 'cr_cost', 'damage_percentage', 'damage_cost', 'gst', 'profit_percentage')
    @classmethod
    def valid_economics(cls, value):
        if value is not None and (not math.isfinite(value) or value < 0):
            raise ValueError('Cost/rate must be finite and nonnegative')
        return value

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

    profit_percentage: float = 20.0         # profit % on top of breakeven


class PricingUpdate(BaseModel):
    @field_validator('price', 'package', 'logistics', 'addons', 'misc_total', 'cr_percentage', 'cr_cost', 'damage_percentage', 'damage_cost', 'gst', 'profit_percentage')
    @classmethod
    def valid_economics(cls, value):
        if value is not None and (not math.isfinite(value) or value < 0):
            raise ValueError('Cost/rate must be finite and nonnegative')
        return value

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
    profit_percentage: float | None = None


class PricingResponse(BaseModel):
    company_id: int
    cr_cost_override: float | None = None
    damage_cost_override: float | None = None
    misc_total_override: float | None = None
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

    # Profit
    profit_percentage: float

    # Auto-calculated outputs
    breakeven: float
    net_profit_amt: float
    bs_wo_gst: float
    bank_settlement: float

    created_at: datetime

    model_config = {"from_attributes": True}
