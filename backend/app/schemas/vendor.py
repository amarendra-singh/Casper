from pydantic import BaseModel
from datetime import datetime


class VendorCreate(BaseModel):
    name: str
    short_code: str


class VendorUpdate(BaseModel):
    name: str | None = None
    short_code: str | None = None
    is_active: bool | None = None


class VendorResponse(BaseModel):
    id: int
    name: str
    short_code: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}