from pydantic import BaseModel
from datetime import datetime


class CategoryCreate(BaseModel):
    name: str
    default_cr_pct: float | None = None
    default_damage_pct: float | None = None
    default_profit_pct: float | None = None


class CategoryUpdate(BaseModel):
    name: str | None = None
    is_active: bool | None = None
    default_cr_pct: float | None = None
    default_damage_pct: float | None = None
    default_profit_pct: float | None = None


class CategoryResponse(BaseModel):
    id: int
    name: str
    is_active: bool
    default_cr_pct: float | None = None
    default_damage_pct: float | None = None
    default_profit_pct: float | None = None
    created_at: datetime

    model_config = {"from_attributes": True}