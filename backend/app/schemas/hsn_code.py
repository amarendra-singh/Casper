from pydantic import BaseModel, ConfigDict
from typing import Optional

class HsnCodeCreate(BaseModel):
    code:        str
    description: str
    gst_rate:    float
    category:    Optional[str] = None

class HsnCodeUpdate(BaseModel):
    description: Optional[str]   = None
    gst_rate:    Optional[float] = None
    category:    Optional[str]   = None

class HsnCodeResponse(BaseModel):
    id:          int
    code:        str
    description: str
    gst_rate:    float
    category:    Optional[str]
    is_custom:   bool

    model_config = ConfigDict(from_attributes=True)