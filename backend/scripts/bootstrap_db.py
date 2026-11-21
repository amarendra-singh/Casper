"""
One-time production DB bootstrap. Works against whatever DATABASE_URL is set —
SQLite locally or Postgres in production (Neon / Supabase / Vercel Postgres).

Creates every table and seeds a first super-admin + company (with all modules
and the standard platform set). Idempotent: safe to re-run.

Usage (from backend/, with env vars set):
    SECRET_KEY=... DATABASE_URL=postgresql+asyncpg://USER:PASS@HOST/DB \
        python -m scripts.bootstrap_db
"""
import asyncio
import os
from pathlib import Path

from alembic import command
from alembic.config import Config

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.core.security import hash_password
from app.models.user import User, UserRole
from app.services.company import create_company

ADMIN_EMAIL = os.getenv("SEED_ADMIN_EMAIL", "admin@casper.com")
ADMIN_PASSWORD = os.getenv("SEED_ADMIN_PASSWORD", "Admin@1234")
ADMIN_NAME = os.getenv("SEED_ADMIN_NAME", "Super Admin")
COMPANY_NAME = os.getenv("SEED_COMPANY_NAME", "My Company")


def upgrade_schema() -> None:
    """
    Bring the database to the latest migration.

    Never create_all here. create_all builds the tables but writes no
    alembic_version row, so the next deploy's `upgrade head` replays the whole
    chain against tables that already exist and fails. That is exactly how this
    database ended up nine tables and twenty-three columns ahead of its own
    migration chain, with the gap filled in by ad-hoc scripts.
    """
    backend = Path(__file__).resolve().parents[1]
    cfg = Config(str(backend / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend / "alembic"))
    command.upgrade(cfg, "head")


async def main():
    # 1. Schema
    await asyncio.to_thread(upgrade_schema)
    print("Schema at head (alembic upgrade).")

    # 2. Seed admin + first company
    async with AsyncSessionLocal() as db:
        admin = (await db.execute(select(User).where(User.email == ADMIN_EMAIL))).scalar_one_or_none()
        if admin is None:
            from app.core.config import settings
            if settings.APP_ENV != 'development' and not os.getenv('SEED_ADMIN_PASSWORD'):
                raise RuntimeError('SEED_ADMIN_PASSWORD is required for a new production administrator')
            admin = User(name=ADMIN_NAME, email=ADMIN_EMAIL,
                         password_hash=hash_password(ADMIN_PASSWORD),
                         role=UserRole.super_admin, is_active=True)
            db.add(admin)
            await db.flush()
            await create_company(db, admin.id, COMPANY_NAME)  # membership + modules + platforms
            await db.commit()
            print(f"Seeded super-admin {ADMIN_EMAIL} + company '{COMPANY_NAME}'.")
        else:
            print(f"Admin {ADMIN_EMAIL} already exists — skipped seeding.")

    print("Bootstrap complete.")


if __name__ == "__main__":
    asyncio.run(main())
