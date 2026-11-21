import math
from pydantic import BaseModel, field_validator, ConfigDict, Field
from typing import Optional, List


class PlatformOverride(BaseModel):
    """Per-platform AD, profit overrides and SKU name alias sent from the frontend."""
    model_config = ConfigDict(allow_inf_nan=False)

    @field_validator('ad_pct', 'profit_pct', 'reverse_shipping_charge')
    @classmethod
    def valid_override(cls, value, info):
        if value is not None and (value < 0 or (info.field_name == 'ad_pct' and value > 100)):
            raise ValueError('Override must be nonnegative; ad percentage must be at most 100')
        return value

    platform_id:       int
    ad_pct:            Optional[float] = None   # None = inherit platform.default_ad_pct
    profit_pct:        Optional[float] = None   # None = inherit platform.default_profit_pct
    reverse_shipping_charge: Optional[float] = None  # None = inherit platform.cr_charge
    platform_sku_name: Optional[str]   = None   # None = use global shringar_sku


class PlatformConfigResponse(BaseModel):
    """Per-platform config returned to the frontend."""
    platform_id:       int
    ad_pct:            Optional[float] = None
    profit_pct:        Optional[float] = None
    reverse_shipping_charge: Optional[float] = None
    platform_sku_name: Optional[str]   = None

    model_config = ConfigDict(from_attributes=True)


class EntryRowInput(BaseModel):
    @field_validator('price', 'package', 'logistics', 'addons', 'misc_total', 'cr_percentage', 'cr_cost', 'damage_percentage', 'damage_cost', 'gst', 'profit_percentage')
    @classmethod
    def valid_economics(cls, value):
        if value is not None and (not math.isfinite(value) or value < 0):
            raise ValueError('Cost/rate must be finite and nonnegative')
        return value

    @field_validator('cr_percentage', 'damage_percentage', 'gst')
    @classmethod
    def bounded_percentage(cls, value):
        if value is not None and value > 100:
            raise ValueError('Percentage must be at most 100')
        return value

    # Accept both 'sku' (new frontend name) and 'shringar_sku' (old name)
    sku_id: Optional[int] = None
    shringar_sku:  str = Field(..., alias='sku')
    vendor_id:     Optional[int] = None
    category_id:   Optional[int] = None
    hsn_code_id:   Optional[int] = None
    description:   Optional[str] = None

    vendor_sku:    Optional[str] = None
    series:        Optional[str] = None

    # Unit economics
    price:         float
    package:       Optional[float] = 0
    logistics:     Optional[float] = 0
    addons:        Optional[float] = 0
    misc_total:    Optional[float] = None   # None = use global setting
    cr_percentage: Optional[float] = None   # None = use platform default
    cr_cost:       Optional[float] = None   # None = auto from cr_percentage
    damage_percentage: Optional[float] = None  # None = use global (15%)
    damage_cost:   Optional[float] = None   # None = auto from damage_percentage
    gst:           Optional[float] = None

    # Global profit fallback (applies to all platforms unless overridden per-platform)
    profit_percentage: Optional[float] = None  # None = use global (20%)

    # Per-platform AD and profit overrides
    platform_overrides: List[PlatformOverride] = []

    # Allow both 'sku' and 'shringar_sku' field names
    model_config = ConfigDict(populate_by_name=True)

    @field_validator('shringar_sku')
    @classmethod
    def sku_must_not_be_empty(cls, v):
        v = v.strip().upper()
        if not v:
            raise ValueError('SKU cannot be empty')
        return v

    @field_validator('price')
    @classmethod
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
    is_active: bool = True
    base_reference_valid: bool = True
    base_platform_id: Optional[int] = None
    base_cr_charge: Optional[float] = None
    cr_cost_override: Optional[float] = None
    damage_cost_override: Optional[float] = None
    misc_total_override: Optional[float] = None
    id:            int
    shringar_sku:  str
    # Which company owns this row. Required in consolidated ("All Companies") mode:
    # without it a merged list is indistinguishable, and you cannot tell whose
    # record you are about to edit.
    company_id:    Optional[int] = None
    company_name:  Optional[str] = None
    company_color: Optional[str] = None
    vendor_id:     Optional[int] = None
    vendor_name:   Optional[str] = None
    vendor_short:  Optional[str] = None
    vendor_sku:    Optional[str] = None
    series:        Optional[str] = None
    category_id:   Optional[int] = None
    category_name: Optional[str] = None
    hsn_code_id:   Optional[int] = None
    hsn_code:      Optional[str] = None
    gst_rate:      Optional[float] = None
    description:   Optional[str] = None
    price:         Optional[float] = None
    package:       Optional[float] = None
    logistics:     Optional[float] = None
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

    # Per-platform overrides loaded from sku_platform_config
    platform_configs: List[PlatformConfigResponse] = []

    model_config = ConfigDict(from_attributes=True)


class UpsertBatchRequest(BaseModel):
    rows: List[EntryRowInput]

    @field_validator('rows')
    @classmethod
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
