from app.core.time import utcnow
from datetime import datetime
from sqlalchemy import String, Float, Boolean, DateTime, Integer, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class MiscItem(Base):
    __tablename__ = "misc_items"
    __table_args__ = (UniqueConstraint("company_id", "name", name="uq_misc_company_name"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, comment="e.g. Rent, Electricity, Internet")
    amount: Mapped[float] = mapped_column(Float, nullable=False, comment="Monthly amount in INR")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)