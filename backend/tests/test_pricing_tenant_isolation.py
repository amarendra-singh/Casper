"""
Tenant isolation for the three lookups that feed every breakeven.

Regression guard. These were written unscoped, so `upsert_batch` for one company
summed another company's misc items, read its global settings, and picked its
platform as the pricing anchor — 95 live SKUs ended up priced off a foreign
"TestPlatform" with a foreign ₹100 "TestMisc" baked into their cost floor.

The existing suite passed throughout, because nothing exercised two companies at
once. That is exactly what these tests do.
"""
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

import app.models  # noqa: F401 — registers every table on Base.metadata
from app.core.database import Base
from app.models.company import Company
from app.models.user import User
from app.models.platform import Platform
from app.models.misc_item import MiscItem
from app.models.global_settings import GlobalSettings
from app.services.entries import get_misc_total, get_damage_percent, get_platforms

CO_A, CO_B = 1, 2


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        s.add_all([
            User(id=1, name="Owner", email="owner@test.local", password_hash="x"),
            Company(id=CO_A, name="Company A", slug="company-a", owner_id=1),
            Company(id=CO_B, name="Company B", slug="company-b", owner_id=1),
            # A owns a test platform and a ₹100 misc charge; B owns neither.
            Platform(id=10, name="A-TestPlatform", company_id=CO_A, is_active=True,
                     cr_percentage=5.0, cr_charge=50.0),
            Platform(id=20, name="B-Flipkart", company_id=CO_B, is_active=True,
                     cr_percentage=9.0, cr_charge=80.0),
            MiscItem(id=1, name="A-TestMisc", amount=100.0, company_id=CO_A, is_active=True),
            GlobalSettings(id=1, key="damage_percent", value="20.0", company_id=CO_A),
        ])
        await s.commit()
        yield s
    await engine.dispose()


@pytest.mark.asyncio
async def test_misc_total_does_not_leak_across_companies(db):
    assert await get_misc_total(db, CO_A) == 100.0
    # B has no misc items of its own — it must not inherit A's ₹100.
    assert await get_misc_total(db, CO_B) == 0.0


@pytest.mark.asyncio
async def test_damage_percent_does_not_leak_across_companies(db):
    assert await get_damage_percent(db, CO_A) == 20.0
    # B has no setting — falls back to the app default, not A's value.
    assert await get_damage_percent(db, CO_B) == 15.0


@pytest.mark.asyncio
async def test_platforms_are_company_scoped(db):
    a = await get_platforms(db, CO_A)
    b = await get_platforms(db, CO_B)
    assert [p.name for p in a] == ["A-TestPlatform"]
    assert [p.name for p in b] == ["B-Flipkart"]
    # The pricing anchor is platforms[0]; it must never be another tenant's.
    assert b[0].company_id == CO_B
    assert b[0].cr_charge == 80.0


@pytest.mark.asyncio
async def test_company_with_no_platforms_gets_empty_not_foreign(db):
    assert await get_platforms(db, 999) == []
