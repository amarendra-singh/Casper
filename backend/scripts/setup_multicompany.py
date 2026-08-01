"""
Phase 1 multi-company setup — idempotent.

Creates the three tenancy tables (companies, company_memberships,
company_modules) if missing, then backfills a default company owned by the
existing admin, an owner membership, and all modules enabled.

The worktree's Alembic chain is behind the actual DB, so this uses
create_all(checkfirst) rather than a migration. For the main project, author
proper Alembic migrations. Run from backend/:
    SECRET_KEY=x python -m scripts.setup_multicompany
"""
import re
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import Base
import app.models  # noqa: F401 — registers every model on Base.metadata
from app.models.company import Company, CompanyMembership, CompanyModule, CompanyRole, MODULE_KEYS
from app.models.user import User


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "company"


def main() -> None:
    engine = create_engine(settings.DATABASE_URL_SYNC)
    Base.metadata.create_all(
        engine,
        tables=[Company.__table__, CompanyMembership.__table__, CompanyModule.__table__],
    )
    print("Tables ensured: companies, company_memberships, company_modules")

    with Session(engine) as db:
        if db.execute(select(Company)).first():
            print("Companies already exist — skipping backfill.")
            return
        admin = db.execute(select(User).order_by(User.id)).scalars().first()
        if not admin:
            print("No users found — nothing to backfill.")
            return
        co = Company(
            name="Shringar House Jewellery",
            slug=slugify("Shringar House Jewellery"),
            color="#EC2D6E",
            owner_id=admin.id,
        )
        db.add(co)
        db.flush()
        db.add(CompanyMembership(company_id=co.id, user_id=admin.id, role=CompanyRole.owner))
        for mk in MODULE_KEYS:
            db.add(CompanyModule(company_id=co.id, module_key=mk, enabled=True))
        db.commit()
        print(f"Default company '{co.name}' (id={co.id}) owner={admin.email}, {len(MODULE_KEYS)} modules enabled.")


if __name__ == "__main__":
    main()
