import asyncio
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.core.security import hash_password
from app.models.user import User, UserRole
from app.models.global_settings import GlobalSettings



async def seed():
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.email == "admin@casper.com"))
        if result.scalar_one_or_none():
            print("Super admin already exists.")
            return

        user = User(
            name="Super Admin",
            email="admin@casper.com",
            password_hash=hash_password("Admin@1234"),
            role=UserRole.super_admin,
        )
        db.add(user)
        print("✅ Super admin created: admin@casper.com / Admin@1234")

        defaults = [
            ("damage_percent", "20.0", "Default damage % of price"),
        ]
        for key, value, description in defaults:
            existing = await db.execute(
                select(GlobalSettings).where(GlobalSettings.key == key)
            )
            if not existing.scalar_one_or_none():
                db.add(GlobalSettings(key=key, value=value, description=description))
                print(f"✅ Setting added: {key} = {value}")

        await db.commit()
        print("✅ Seed complete")


if __name__ == "__main__":
    asyncio.run(seed())