import json
from pathlib import Path
from types import SimpleNamespace
import pytest
from sqlalchemy import select
from tests.test_audit_regressions import db  # noqa: F401
from app.models.sku import Sku, SkuPricing
from app.models.platform import Platform
from app.schemas.entries import EntryRowInput
from app.schemas.sku import PricingCreate
from app.services.entries import upsert_batch, _resolve_pricing_inputs
from app.services.pricing import resolve_pricing_inputs
from app.routes.skus import create_pricing
from app.services.pnl import _build_sku_row

CASES = json.loads((Path(__file__).resolve().parents[2] / 'audit/unit-engine-cases.json').read_text())


@pytest.mark.asyncio
@pytest.mark.parametrize('case', CASES, ids=lambda c: c['name'])
async def test_grid_save_dedicated_api_and_report_snapshot_agree(db, case):
    platform = await db.get(Platform, 1)
    platform.cr_charge = 100
    inputs = {k: v for k, v in case.items() if k not in ('name', 'expected')}
    row = EntryRowInput(sku='GRID-' + case['name'], **inputs)
    saved, errors = await upsert_batch(db, [row], 1)
    assert not errors
    grid = await db.scalar(select(SkuPricing).where(SkuPricing.sku_id == saved[0].sku_id))
    sku = Sku(company_id=1, shringar_sku='API-' + case['name'])
    db.add(sku)
    await db.flush()
    api = await create_pricing(PricingCreate(sku_id=sku.id, platform_id=1, **inputs), db, SimpleNamespace(id=1), None)
    for key, expected in case['expected'].items():
        assert getattr(grid, key) == expected
        assert getattr(api, key) == expected
    assert grid.cr_percentage == api.cr_percentage
    assert grid.damage_percentage == api.damage_percentage
    snap = _build_sku_row({'platform_sku_name': sku.shringar_sku, 'net_units': 2, 'bank_settlement_projected': 500,
                          'net_margin_pct': 20}, 1, api, 1)
    assert snap.variance_margin_pct is None
    assert snap.snap_breakeven == case['expected']['breakeven']
    assert snap.casper_expected_bs == case['expected']['bank_settlement']
    frozen = snap.snap_cogs_per_unit
    api.price = 999
    assert snap.snap_cogs_per_unit == frozen


@pytest.mark.asyncio
async def test_derived_allowances_use_same_precision_and_zero_override(db):
    platform = await db.get(Platform, 1)
    platform.cr_charge = 13.37
    for override in (None, 0, 2.25):
        row = EntryRowInput(sku='X', price=17.35, cr_percentage=7.25, damage_percentage=3.75,
                            cr_cost=override, damage_cost=override, misc_total=0)
        grid = _resolve_pricing_inputs(row, 0, 15, 20, platform)
        api = await resolve_pricing_inputs(db, 1, 1, row.price, row.cr_percentage,
            override, row.damage_percentage, override, 0)
        for key in ('cr_percentage', 'cr_cost', 'damage_percentage', 'damage_cost', 'misc_total'):
            assert grid[key] == api[key]
