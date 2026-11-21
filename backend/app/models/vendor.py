from app.core.time import utcnow
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, Integer, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class Vendor(Base):
    __tablename__ = "vendors"
    # Both keys are per-company: two tenants may each have a vendor "JE".
    __table_args__ = (
        UniqueConstraint("company_id", "short_code", name="uq_vendor_company_code"),
        UniqueConstraint("company_id", "name", name="uq_vendor_company_name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    short_code: Mapped[str] = mapped_column(String(20), nullable=False, index=True, comment="e.g. VRI, VIC")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    # Relationships
    skus: Mapped[list["Sku"]] = relationship("Sku", back_populates="vendor")
# Forward references avoid runtime import cycles between mapped models.
class VendorNameAlias(Base):
    __tablename__ = "vendor_name_aliases"
    __table_args__ = (UniqueConstraint("company_id", "name", name="uq_vendor_name_alias_company"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), nullable=False)
    vendor_id: Mapped[int] = mapped_column(ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)


from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from app.models.sku import Sku
