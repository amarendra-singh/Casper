"""
Company / tenancy service. See docs/multi-company-architecture.md.
"""
import re
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company import Company, CompanyMembership, CompanyModule, CompanyRole, MODULE_KEYS
from app.models.platform import Platform
from app.models.user import User, UserRole
from app.core.security import hash_password


# Standard Indian marketplace platforms every new company starts with, so it can
# price SKUs and upload settlements immediately. Fee config is per-company and
# editable in Settings afterwards. (TestPlatform is intentionally not seeded.)
STANDARD_PLATFORMS = [
    {"name": "Flipkart", "cr_charge": 50.0,  "cr_percentage": 5.0,  "default_ad_pct": 2.0,  "default_profit_pct": 25.0},
    {"name": "Meesho",   "cr_charge": 0.0,   "cr_percentage": 0.0,  "default_ad_pct": 2.0,  "default_profit_pct": 25.0},
    {"name": "Snapdeal", "cr_charge": 0.0,   "cr_percentage": 0.0,  "default_ad_pct": 2.0,  "default_profit_pct": 25.0},
    {"name": "ShopDeck", "cr_charge": 100.0, "cr_percentage": 20.0, "default_ad_pct": 10.0, "default_profit_pct": 20.0},
]


async def seed_platforms(db: AsyncSession, company_id: int) -> None:
    """Create any missing standard platforms for a company (idempotent by name)."""
    existing = {
        n for (n,) in (await db.execute(
            select(Platform.name).where(Platform.company_id == company_id)
        )).all()
    }
    for p in STANDARD_PLATFORMS:
        if p["name"] not in existing:
            db.add(Platform(company_id=company_id, **p))


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
    await seed_platforms(db, co.id)   # give the new company its own platform set
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


async def rename_company(db: AsyncSession, company_id: int, name: str):
    """Update a company's display name (slug stays stable). Returns Company or None."""
    co = (await db.execute(select(Company).where(Company.id == company_id))).scalar_one_or_none()
    if not co:
        return None
    co.name = name.strip()
    return co


async def archive_company(db: AsyncSession, company_id: int) -> bool:
    """Soft-delete: mark inactive so it drops out of the switcher. Data is retained."""
    co = (await db.execute(select(Company).where(Company.id == company_id))).scalar_one_or_none()
    if not co:
        return False
    co.is_active = False
    return True


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


async def list_members(db: AsyncSession, company_id: int):
    """Return [(User, role)] for every member of the company."""
    rows = await db.execute(
        select(User, CompanyMembership.role)
        .join(CompanyMembership, CompanyMembership.user_id == User.id)
        .where(CompanyMembership.company_id == company_id)
        .order_by(CompanyMembership.created_at)
    )
    return rows.all()


async def add_member(db: AsyncSession, company_id: int, email: str, name: str,
                     password: str | None, role: CompanyRole):
    """
    Add a member to a company. If the email already belongs to a user, reuse
    that account; otherwise create it (temp password required for a new user).
    Returns (User, role). Raises ValueError on conflict/missing data.
    """
    email = email.strip().lower()
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None:
        if not password:
            raise ValueError("A temporary password is required for a new user")
        user = User(name=name.strip() or email, email=email,
                    password_hash=hash_password(password),
                    role=UserRole.viewer, is_active=True)
        db.add(user)
        await db.flush()
    else:
        existing = (await db.execute(
            select(CompanyMembership).where(
                CompanyMembership.company_id == company_id,
                CompanyMembership.user_id == user.id)
        )).scalar_one_or_none()
        if existing:
            raise ValueError("This user is already a member of the company")
    db.add(CompanyMembership(company_id=company_id, user_id=user.id, role=role))
    return user, role


async def update_member_role(db: AsyncSession, company_id: int, user_id: int, role: CompanyRole):
    m = (await db.execute(
        select(CompanyMembership).where(
            CompanyMembership.company_id == company_id, CompanyMembership.user_id == user_id)
    )).scalar_one_or_none()
    if not m:
        return None
    m.role = role
    return m


async def remove_member(db: AsyncSession, company_id: int, user_id: int) -> bool:
    m = (await db.execute(
        select(CompanyMembership).where(
            CompanyMembership.company_id == company_id, CompanyMembership.user_id == user_id)
    )).scalar_one_or_none()
    if not m:
        return False
    await db.delete(m)
    return True


async def set_company_modules(db: AsyncSession, company_id: int, updates: dict[str, bool]) -> None:
    """Upsert per-company module enablement (only known module keys)."""
    for key, enabled in updates.items():
        if key not in MODULE_KEYS:
            continue
        row = (await db.execute(
            select(CompanyModule).where(
                CompanyModule.company_id == company_id, CompanyModule.module_key == key
            )
        )).scalar_one_or_none()
        if row:
            row.enabled = enabled
        else:
            db.add(CompanyModule(company_id=company_id, module_key=key, enabled=enabled))
