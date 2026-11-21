"""Cross-feature regressions on disposable, FK-enforced records."""
from datetime import date
from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from sqlalchemy import select
from tests.test_audit_regressions import db, client  # noqa: F401
from app.models.audit import FinancialChange
from app.models.sku import SkuPricing, SkuPlatformConfig
from app.models.pnl import PnlReport, PnlSkuRow
from app.models.fraud import SkuRiskScore
from app.services.undo import undo_change
from app.services.pnl import _build_pricing_lookup, delete_report, pricing_snapshot
from app.services.pnl_statement import recover_unpriced_reports
from app.services.purchase import sku_candidates


async def edited_pricing(db):
    pricing = await db.get(SkuPricing, 1)
    pricing.price = 123
    await db.commit()
    change = await db.scalar(select(FinancialChange).where(
        FinancialChange.entity_type == 'sku_pricing', FinancialChange.entity_id == 1
    ).order_by(FinancialChange.id.desc()).limit(1))
    return pricing, change


@pytest.mark.asyncio
async def test_undo_restores_and_records_inverse_and_blocks_replay(db):
    pricing, change = await edited_pricing(db)
    await undo_change(db, change)
    assert pricing.price == 100
    inverse = await db.scalar(select(FinancialChange).order_by(FinancialChange.id.desc()).limit(1))
    assert inverse.before['price'] == 123 and inverse.after['price'] == 100
    with pytest.raises(HTTPException) as exc:
        await undo_change(db, change)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_undo_rejects_newer_edit(db):
    pricing, change = await edited_pricing(db)
    pricing.price = 150
    await db.commit()
    with pytest.raises(HTTPException) as exc:
        await undo_change(db, change)
    assert exc.value.status_code == 409 and pricing.price == 150


@pytest.mark.asyncio
async def test_undo_requires_company_write_role(client, db):
    _, change = await edited_pricing(db)
    response = await client.post(f'/api/v1/change-history/{change.id}/undo')
    assert response.status_code == 403


def report(company=1):
    return PnlReport(company_id=company, platform_id=company, uploaded_by=company,
        period_start=date(2026, 9, 1), period_end=date(2026, 9, 30), filename='synthetic.xlsx')


@pytest.mark.asyncio
async def test_recovery_complete_snapshot_scoped_idempotent_frozen(db):
    own, foreign = report(), report(2)
    db.add_all([own, foreign])
    await db.flush()
    pending = PnlSkuRow(company_id=1, report_id=own.id, platform_sku_name='AUDIT-SKU',
        net_units=2, bank_settlement_projected=250)
    frozen = PnlSkuRow(company_id=1, report_id=own.id, platform_sku_name='AUDIT-SKU', snap_breakeven=80)
    other = PnlSkuRow(company_id=2, report_id=foreign.id, platform_sku_name='AUDIT-SKU')
    db.add_all([pending, frozen, other])
    await db.commit()
    assert await recover_unpriced_reports(db, 1) == 1
    pricing = await db.get(SkuPricing, 1)
    for key, value in pricing_snapshot(pricing, 250, 2).items():
        assert getattr(pending, key) == value
    assert pending.variance_bs == 10
    assert frozen.snap_breakeven == 80 and frozen.sku_pricing_id is None
    assert other.sku_pricing_id is None
    pricing.price = 999
    assert await recover_unpriced_reports(db, 1) == 0
    assert pending.snap_cogs_per_unit == 100


@pytest.mark.asyncio
async def test_alias_collision_does_not_choose_arbitrary_cost(db):
    from app.models.sku import Sku
    sku = Sku(company_id=1, shringar_sku='SECOND')
    db.add(sku)
    await db.flush()
    pricing = SkuPricing(company_id=1, sku_id=sku.id, platform_id=1, price=900,
        cr_percentage=0, cr_cost=0, damage_percentage=0, damage_cost=0)
    db.add(pricing)
    await db.flush()
    db.add(SkuPlatformConfig(company_id=1, sku_pricing_id=pricing.id, platform_id=1,
        platform_sku_name=' audit-sku '))
    await db.flush()
    lookup = await _build_pricing_lookup(db, 1, 1)
    assert 'AUDIT-SKU' not in lookup
    assert lookup['SECOND'].id == pricing.id


@pytest.mark.asyncio
async def test_delete_last_report_clears_derived_risk_only_in_scope(db):
    own = report()
    db.add(own)
    db.add_all([SkuRiskScore(company_id=1, platform_id=1, sku_platform_name='STALE'),
                SkuRiskScore(company_id=2, platform_id=2, sku_platform_name='KEEP')])
    await db.commit()
    assert await delete_report(db, own.id, 1)
    scores = (await db.scalars(select(SkuRiskScore))).all()
    assert [s.sku_platform_name for s in scores] == ['KEEP']


def test_candidate_matching_respects_supplier():
    skus = [SimpleNamespace(id=i, vendor_id=i, shringar_sku='PKTY-26',
        vendor_sku='PKTY-26', description='Candy tray') for i in (1, 2)]
    assert [s.id for s in sku_candidates('PKTY-26 CANDY TRAY', skus, 1)] == [1]


@pytest.mark.asyncio
async def test_bill_cost_does_not_overwrite_other_platforms(db):
    from app.models.platform import Platform
    from app.models.purchase import PurchaseBill, PurchaseBillLine
    from app.services.purchase import apply_cost
    db.add(Platform(id=3, name='Second channel', company_id=1, cr_charge=0, cr_percentage=0))
    await db.flush()
    other = SkuPricing(company_id=1, sku_id=1, platform_id=3, price=777,
        cr_percentage=0, cr_cost=0, damage_percentage=0, damage_cost=0)
    bill = PurchaseBill(company_id=1, ref_no='MULTI', bill_date=date(2026, 9, 1))
    db.add_all([other, bill])
    await db.flush()
    line = PurchaseBillLine(bill_id=bill.id, item_name='AUDIT-SKU', sku_id=1,
        match_source='manual', price_unit=270, pack_multiple=3)
    db.add(line)
    await db.commit()
    assert not (await apply_cost(db, 1, line.id))['ok']
    assert (await apply_cost(db, 1, line.id, 1))['ok']
    assert (await db.get(SkuPricing, 1)).price == 90
    assert other.price == 777


@pytest.mark.asyncio
async def test_create_cost_api_recovers_existing_report(db):
    from app.models.sku import Sku
    from app.routes.skus import create_pricing
    from app.schemas.sku import PricingCreate
    sku = Sku(company_id=1, shringar_sku='NEW-COST')
    own = report()
    db.add_all([sku, own])
    await db.flush()
    row = PnlSkuRow(company_id=1, report_id=own.id, platform_sku_name='NEW-COST', net_units=3)
    db.add(row)
    await db.commit()
    created = await create_pricing(PricingCreate(sku_id=sku.id, platform_id=1, price=40),
        db, SimpleNamespace(id=1), None)
    assert row.sku_pricing_id == created.id and row.snap_cogs_per_unit == 40
