from pydantic import BaseModel, Field, StringConstraints
from typing import Annotated
from datetime import datetime

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Money = Annotated[float, Field(ge=0, allow_inf_nan=False)]
Percent = Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)]


class PlatformTierCreate(BaseModel):
    tier_name: Name
    fee: Money = 0.0           # ₹ (used when fee_pct is null)
    fee_pct: Percent | None = None  # % of base — takes precedence over `fee` if set


class PlatformTierUpdate(BaseModel):
    tier_name: Name | None = None
    fee: Money | None = None
    fee_pct: Percent | None = None


class PlatformTierResponse(BaseModel):
    id: int
    tier_name: str
    fee: float
    fee_pct: float | None = None

    model_config = {"from_attributes": True}


class PlatformCreate(BaseModel):
    name: Name
    cr_charge: Money
    cr_percentage: Percent
    default_ad_pct: Percent = 0.0
    default_profit_pct: Money = 20.0
    target_monthly_units: int = Field(default=700, gt=0)
    tiers: list[PlatformTierCreate] = []


class PlatformUpdate(BaseModel):
    name: Name | None = None
    cr_charge: Money | None = None
    cr_percentage: Percent | None = None
    default_ad_pct: Percent | None = None
    default_profit_pct: Money | None = None
    target_monthly_units: int | None = Field(default=None, gt=0)
    is_active: bool | None = None


class PlatformResponse(BaseModel):
    company_id: int
    id: int
    name: str
    cr_charge: float
    cr_percentage: float
    default_ad_pct: float
    default_profit_pct: float
    target_monthly_units: int = 700
    is_active: bool
    tiers: list[PlatformTierResponse] = []
    created_at: datetime

    model_config = {"from_attributes": True}