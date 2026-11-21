from app.core.time import utcnow
from datetime import datetime
from sqlalchemy import String, DateTime, Integer, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class GlobalSettings(Base):
    __tablename__ = "global_settings"
    # One row per company per key. The old global unique on `key` meant a single
    # company could store damage_percent and every other tenant silently fell
    # back to the hardcoded default — they could not save their own.
    __table_args__ = (UniqueConstraint("company_id", "key", name="uq_setting_company_key"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    value: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)