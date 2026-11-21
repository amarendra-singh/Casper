"""Per-SKU reverse-shipping charge inherits, overrides, and clears safely."""
import pytest
from sqlalchemy import select

from tests.test_audit_regressions import db  # noqa: F401
from app.models.platform import Platform
from app.models.sku import SkuPricing, SkuPlatformConfig
from app.schemas.entries import EntryRowInput, PlatformOverride
from app.services.entries import upsert_batch, get_all_entries
from app.services.catalogue import product_profile
from app.services.pricing import recalculate_pricing


@pytest.mark.asyncio
async def test_sku_reverse_shipping_override_round_trip_and_clear(db):
    platform = await db.get(Platform, 1)
    platform.cr_charge = 100
    platform.cr_percentage = 10
    await db.commit()

    async def save(charge):
        saved, errors = await upsert_batch(db, [EntryRowInput(
            sku="AUDIT-SKU", sku_id=1, price=100, cr_percentage=10,
            damage_percentage=0,
            platform_overrides=[PlatformOverride(platform_id=1, reverse_shipping_charge=charge)],
        )], 1)
        assert len(saved) == 1 and errors == []
        await db.commit()
        return await db.get(SkuPricing, 1)

    pricing = await save(40)
    assert pricing.cr_cost == 4
    config = await db.scalar(select(SkuPlatformConfig).where(SkuPlatformConfig.platform_id == 1))
    assert config.reverse_shipping_charge == 40
    rows = await get_all_entries(db, 1)
    assert rows[0]["platform_configs"][0]["reverse_shipping_charge"] == 40
    profile = await product_profile(db, [1], 1)
    assert profile["pricing"][0]["reverse_shipping_charge"] == 40
    assert profile["pricing"][0]["reverse_shipping_overridden"] is True

    platform.cr_charge = 120
    await recalculate_pricing(db, pricing)
    assert pricing.cr_cost == 4  # platform edit does not override the SKU setting

    pricing = await save(0)
    assert pricing.cr_cost == 0  # explicit zero is distinct from inherit

    pricing = await save(None)
    assert pricing.cr_cost == 12
    assert await db.scalar(select(SkuPlatformConfig).where(SkuPlatformConfig.platform_id == 1)) is None
