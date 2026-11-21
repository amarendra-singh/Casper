import pytest
from sqlalchemy import select, func
from tests.test_audit_regressions import db, client  # noqa: F401
from tests.test_connection_recovery import report
from app.models.sku import Sku, SkuPricing
from app.models.pnl import PnlSkuRow
from app.models.marketplace_alias import MarketplaceSkuAlias
from app.models.misc_item import MiscItem
from app.services.marketplace_identity import link_identity
from app.services.pnl_statement import quick_add_hidden_sku
from app.services.pricing_refresh import build_refresh_plan, apply_refresh_plan


@pytest.mark.asyncio
async def test_link_uncosted_product_then_add_cost_without_duplicate(db):
    sku = Sku(company_id=1, shringar_sku='PRODUCT-ONLY')
    rep = report()
    db.add_all([sku, rep]); await db.flush()
    row = PnlSkuRow(company_id=1, report_id=rep.id, platform_sku_name='Marketplace title')
    db.add(row); await db.commit()
    linked = await link_identity(db, 1, rep.id, row.platform_sku_name, sku.id)
    assert linked['rows_matched'] == 0
    assert await db.scalar(select(func.count()).select_from(MarketplaceSkuAlias)) == 1
    result = await quick_add_hidden_sku(db, 1, rep.id, row.platform_sku_name, 45)
    assert result['created'] and result['rows_matched'] == 1
    assert (await db.get(SkuPricing, row.sku_pricing_id)).sku_id == sku.id
    assert await db.scalar(select(func.count()).select_from(Sku)) == 3
    assert row.snap_cogs_per_unit == 45
    again = await link_identity(db, 1, rep.id, row.platform_sku_name, sku.id)
    assert again['rows_matched'] == 0


@pytest.mark.asyncio
async def test_identity_rejects_foreign_sku_and_conflicting_name(db):
    rep = report(); db.add(rep); await db.flush()
    db.add(PnlSkuRow(company_id=1, report_id=rep.id, platform_sku_name='AUDIT-SKU'))
    other = Sku(company_id=1, shringar_sku='OTHER'); db.add(other); await db.commit()
    with pytest.raises(ValueError, match='Invalid sku_id'):
        await link_identity(db, 1, rep.id, 'AUDIT-SKU', 2)
    with pytest.raises(ValueError, match='another product'):
        await link_identity(db, 1, rep.id, 'AUDIT-SKU', other.id)


@pytest.mark.asyncio
async def test_refresh_preview_no_write_apply_preserves_override_and_blocks_stale(db):
    pricing = await db.get(SkuPricing, 1)
    pricing.cr_cost_override = 7
    pricing.cr_cost = 7
    item = MiscItem(company_id=1, name='Handling', amount=12, is_active=True)
    db.add(item); await db.commit()
    plan = await build_refresh_plan(db, 1)
    assert pricing.misc_total == 0
    assert plan['updates'][0]['changes']['misc_total']['after'] == 12
    item.amount = 15; await db.commit()
    with pytest.raises(ValueError, match='changed after'):
        await apply_refresh_plan(db, 1, plan['token'])
    assert pricing.misc_total == 0
    plan = await build_refresh_plan(db, 1)
    result = await apply_refresh_plan(db, 1, plan['token'])
    assert result['updated'] == 1
    assert pricing.misc_total == 15 and pricing.cr_cost == 7
    assert (await build_refresh_plan(db, 1))['updates'] == []


@pytest.mark.asyncio
async def test_connection_writes_require_company_editor(client):
    assert (await client.post('/api/v1/pricing/refresh-preview')).status_code == 403
    assert (await client.post('/api/v1/pnl/marketplace-link', json={
        'report_id': 1, 'sku_id': 1, 'platform_sku_name': 'X'})).status_code == 403
