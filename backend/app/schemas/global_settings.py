from pydantic import BaseModel
from datetime import datetime


class GlobalSettingUpdate(BaseModel):
    value: str
    description: str | None = None


class GlobalSettingResponse(BaseModel):
    id: int
    key: str
    value: str
    description: str | None
    updated_at: datetime

    model_config = {"from_attributes": True}