from sqlalchemy import Column, Integer, String, Float, Boolean
from app.core.database import Base

class HsnCode(Base):
    __tablename__ = "hsn_codes"

    id          = Column(Integer, primary_key=True, index=True)
    code        = Column(String(20), unique=True, index=True, nullable=False)
    description = Column(String(255), nullable=False)
    gst_rate    = Column(Float, nullable=False)
    category    = Column(String(100), nullable=True)
    is_custom   = Column(Boolean, default=False)