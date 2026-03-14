from pydantic import BaseModel
from datetime import datetime


class MiscItemCreate(BaseModel):
    name: str
    amount: float


class MiscItemUpdate(BaseModel):
    name: str | None = None
    amount: float | None = None
    is_active: bool | None = None


class MiscItemResponse(BaseModel):
    id: int
    name: str
    amount: float
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class MiscTotalResponse(BaseModel):
    total: float
    items: list[MiscItemResponse]