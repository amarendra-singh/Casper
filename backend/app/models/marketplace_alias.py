from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class MarketplaceSkuAlias(Base):
    """Confirmed channel identity, independent of whether a product is costed."""
    __tablename__ = 'marketplace_sku_aliases'
    __table_args__ = (UniqueConstraint('company_id', 'platform_id', 'name', name='uq_marketplace_identity'),)
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey('companies.id'), nullable=False)
    platform_id: Mapped[int] = mapped_column(ForeignKey('platforms.id', ondelete='RESTRICT'), nullable=False)
    sku_id: Mapped[int] = mapped_column(ForeignKey('skus.id', ondelete='RESTRICT'), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
