from pydantic import BaseModel
from typing import Optional

class HsnCodeCreate(BaseModel):
    code:        str
    description: str
    gst_rate:    float
    category:    Optional[str] = None

class HsnCodeResponse(BaseModel):
    id:          int
    code:        str
    description: str
    gst_rate:    float
    category:    Optional[str]
    is_custom:   bool

    class Config:
        from_attributes = True