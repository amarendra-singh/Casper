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

# Importing the app registers every model on Base.metadata via the routers.
import app.main  # noqa: F401
from sqlalchemy import select

from app.core.database import engine, Base, AsyncSessionLocal
from app.core.security import hash_password
from app.models.user import User, UserRole
from app.services.company import create_company

ADMIN_EMAIL = os.getenv("SEED_ADMIN_EMAIL", "admin@casper.com")
ADMIN_PASSWORD = os.getenv("SEED_ADMIN_PASSWORD", "Admin@1234")
ADMIN_NAME = os.getenv("SEED_ADMIN_NAME", "Super Admin")
COMPANY_NAME = os.getenv("SEED_COMPANY_NAME", "My Company")


async def main():
    # 1. Schema
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("Tables created (create_all).")

    # 2. Seed admin + first company
    async with AsyncSessionLocal() as db:
        admin = (await db.execute(select(User).where(User.email == ADMIN_EMAIL))).scalar_one_or_none()
        if admin is None:
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
