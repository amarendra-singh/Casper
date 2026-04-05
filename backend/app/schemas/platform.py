from pydantic import BaseModel
from datetime import datetime


class PlatformTierCreate(BaseModel):
    tier_name: str
    fee: float


class PlatformTierResponse(BaseModel):
    id: int
    tier_name: str
    fee: float

    model_config = {"from_attributes": True}


class PlatformCreate(BaseModel):
    name: str
    cr_charge: float
    cr_percentage: float
    default_ad_pct: float = 0.0
    default_profit_pct: float = 20.0
    tiers: list[PlatformTierCreate] = []


class PlatformUpdate(BaseModel):
    name: str | None = None
    cr_charge: float | None = None
    cr_percentage: float | None = None
    default_ad_pct: float | None = None
    default_profit_pct: float | None = None
    is_active: bool | None = None


class PlatformResponse(BaseModel):
    id: int
    name: str
    cr_charge: float
    cr_percentage: float
    default_ad_pct: float
    default_profit_pct: float
    is_active: bool
    tiers: list[PlatformTierResponse] = []
    created_at: datetime

    model_config = {"from_attributes": True}