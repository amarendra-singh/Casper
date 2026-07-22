"""
Company / tenancy service. See docs/multi-company-architecture.md.
"""
import re
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company import Company, CompanyMembership, CompanyModule, CompanyRole, MODULE_KEYS


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-") or "company"


async def _unique_slug(db: AsyncSession, name: str) -> str:
    base = slugify(name)
    slug, i = base, 1
    while (await db.execute(select(Company).where(Company.slug == slug))).scalar_one_or_none():
        i += 1
        slug = f"{base}-{i}"
    return slug


async def create_company(db: AsyncSession, owner_id: int, name: str,
                         color: str = "#EC2D6E") -> Company:
    """Create a company owned by owner_id, with owner membership + all modules on."""
    co = Company(name=name.strip(), slug=await _unique_slug(db, name), color=color, owner_id=owner_id)
    db.add(co)
    await db.flush()
    db.add(CompanyMembership(company_id=co.id, user_id=owner_id, role=CompanyRole.owner))
    for mk in MODULE_KEYS:
        db.add(CompanyModule(company_id=co.id, module_key=mk, enabled=True))
    return co


async def list_user_companies(db: AsyncSession, user_id: int):
    """Return [(Company, role)] for every company the user belongs to."""
    rows = await db.execute(
        select(Company, CompanyMembership.role)
        .join(CompanyMembership, CompanyMembership.company_id == Company.id)
        .where(CompanyMembership.user_id == user_id, Company.is_active.is_(True))
        .order_by(Company.created_at)
    )
    return rows.all()


async def get_membership(db: AsyncSession, user_id: int, company_id: int):
    """Return (Company, role) if the user belongs to the company, else None."""
    row = await db.execute(
        select(Company, CompanyMembership.role)
        .join(CompanyMembership, CompanyMembership.company_id == Company.id)
        .where(CompanyMembership.user_id == user_id, Company.id == company_id)
    )
    return row.first()


async def get_modules(db: AsyncSession, company_id: int) -> dict[str, bool]:
    rows = await db.execute(select(CompanyModule).where(CompanyModule.company_id == company_id))
    mods = {m.module_key: m.enabled for m in rows.scalars().all()}
    # ensure every known module has a value (default on) even if missing
    return {mk: mods.get(mk, True) for mk in MODULE_KEYS}
