"""
Multi-tenancy models. See docs/multi-company-architecture.md.

One owner → many companies. Users are global identities; a CompanyMembership
grants a user access to a company with a role. CompanyModule enables/disables
modules per company. All tenant data is scoped by company_id (added to the
existing entities in the data-scoping phase).
"""
import enum
from datetime import datetime
from sqlalchemy import String, DateTime, Boolean, ForeignKey, Enum as SAEnum, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class CompanyRole(str, enum.Enum):
    owner = "owner"
    admin = "admin"
    viewer = "viewer"


# Modules a company can have; all enabled by default on creation.
MODULE_KEYS = ["skus", "pricing", "pnl", "fraud", "calculator", "users", "settings"]


class Company(Base):
    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    slug: Mapped[str] = mapped_column(String(160), unique=True, index=True, nullable=False)
    color: Mapped[str] = mapped_column(String(20), default="#EC2D6E", nullable=False)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class CompanyMembership(Base):
    __tablename__ = "company_memberships"
    __table_args__ = (UniqueConstraint("company_id", "user_id", name="uq_company_user"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role: Mapped[CompanyRole] = mapped_column(SAEnum(CompanyRole), default=CompanyRole.viewer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class CompanyModule(Base):
    __tablename__ = "company_modules"
    __table_args__ = (UniqueConstraint("company_id", "module_key", name="uq_company_module"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True)
    module_key: Mapped[str] = mapped_column(String(40), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
