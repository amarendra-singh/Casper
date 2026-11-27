"""Audit evidence: assertions document current defects, not desired behavior.

Run from backend with SECRET_KEY set:
    env/Scripts/python -m pytest ../audit/test_audit_evidence.py -q
All records are synthetic and held in a foreign-key-enforced in-memory DB.
"""
from datetime import date
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

import app.models
from app.core.database import Base, get_db
from app.core.security import create_access_token
from app.main import app
from app.models.user import User, UserRole
from app.models.company import Company, CompanyMembership, CompanyRole
from app.models.platform import Platform
from app.models.vendor import Vendor
from app.models.sku import Sku, SkuPricing
from app.models.purchase import PurchaseBill, PurchaseBillLine
from app.models.billing import Invoice


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine('sqlite+aiosqlite:///:memory:')
    @event.listens_for(engine.sync_engine, 'connect')
    def fk(conn, _):
        conn.execute('PRAGMA foreign_keys=ON')
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        session.add_all([
            User(id=1, name='A', email='a@audit.example', password_hash='x', role=UserRole.admin),
            User(id=2, name='B', email='b@audit.example', password_hash='x', role=UserRole.viewer),
        ])
        await session.flush()
        session.add_all([
            Company(id=1, name='A', slug='audit-a', owner_id=1),
            Company(id=2, name='B', slug='audit-b', owner_id=2),
        ])
        await session.flush()
        session.add_all([
            CompanyMembership(company_id=1, user_id=1, role=CompanyRole.viewer),
            CompanyMembership(company_id=2, user_id=2, role=CompanyRole.owner),
            Platform(id=1, name='Flipkart', company_id=1, cr_charge=0, cr_percentage=0),
            Platform(id=2, name='Flipkart', company_id=2, cr_charge=0, cr_percentage=0),
            Vendor(id=2, name='Foreign vendor', short_code='FV', company_id=2),
            Sku(id=1, shringar_sku='AUDIT-SKU', company_id=1),
            Sku(id=2, shringar_sku='FOREIGN-SKU', company_id=2),
        ])
        await session.flush()
        session.add(SkuPricing(id=1, company_id=1, sku_id=1, platform_id=1,
            price=100, package=0, logistics=0, addons=0, misc_total=0, gst=0,
            profit_percentage=20, cr_percentage=0, cr_cost=0,
            damage_percentage=0, damage_cost=0, breakeven=100,
            net_profit_amt=20, bs_wo_gst=120, bank_settlement=120))
        await session.commit()
        yield session
    await engine.dispose()


@pytest_asyncio.fixture
async def client(db):
    async def override():
        yield db
        await db.commit()
    app.dependency_overrides[get_db] = override
    token = create_access_token({'sub': '1'})
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
        base_url='http://audit', headers={'Authorization': f'Bearer {token}',
                                        'X-Company-Id': '1'}) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_download_does_not_check_report_ownership(client, tmp_path, monkeypatch):
    import app.routes.pnl as routes
    monkeypatch.setattr(routes, 'UPLOADS_DIR', tmp_path)
    (tmp_path / '999.xlsx').write_bytes(b'foreign report contents')
    r = await client.get('/api/v1/pnl/reports/999/file')
    assert r.status_code == 200
    assert r.content == b'foreign report contents'


@pytest.mark.asyncio
async def test_admin_can_list_users_outside_their_company(client):
    r = await client.get('/api/v1/users/')
    assert r.status_code == 200
    assert 'b@audit.example' in [u['email'] for u in r.json()]


@pytest.mark.asyncio
async def test_company_viewer_can_upsert_costs(client, db):
    r = await client.post('/api/v1/entries/upsert-batch', json={
        'rows': [{'sku': 'AUDIT-SKU', 'price': 999}]})
    assert r.status_code == 200
    assert r.json()['saved_count'] == 1
    assert (await db.get(SkuPricing, 1)).price == 999


@pytest.mark.asyncio
async def test_sku_accepts_foreign_company_vendor(client, db):
    r = await client.post('/api/v1/skus/', json={
        'shringar_sku': 'CROSS-TENANT', 'vendor_id': 2})
    assert r.status_code == 201
    assert r.json()['company_id'] == 1 and r.json()['vendor_id'] == 2


@pytest.mark.asyncio
async def test_purchase_cost_changes_price_but_not_cost_floor(db):
    from app.services.purchase import apply_cost
    bill = PurchaseBill(company_id=1, ref_no='COST', bill_date=date(2026, 1, 1))
    db.add(bill)
    await db.flush()
    line = PurchaseBillLine(bill_id=bill.id, item_name='AUDIT-SKU',
        sku_id=1, match_source='suggested', price_unit=200, pack_multiple=1)
    db.add(line)
    await db.commit()
    result = await apply_cost(db, 1, line.id)
    pricing = await db.get(SkuPricing, 1)
    assert result['ok'] is True  # even an unconfirmed suggestion can drive money
    assert pricing.price == 200
    assert pricing.breakeven == 100 and pricing.bank_settlement == 120


@pytest.mark.asyncio
async def test_unregistered_suppliers_with_same_reference_overwrite(db):
    from app.services.purchase import save_bills
    def parsed(amount):
        return [{'ref_no': '1', 'date': '01/01/2026', 'total': amount, 'items': []}]
    await save_bills(db, 1, None, 'Supplier A', parsed(100), 'a.pdf')
    result = await save_bills(db, 1, None, 'Supplier B', parsed(200), 'b.pdf')
    bills = (await db.execute(select(PurchaseBill))).scalars().all()
    assert result['bills_updated'] == 1 and len(bills) == 1
    assert bills[0].party_name == 'Supplier A' and bills[0].total == 200


def test_statement_does_not_foot_when_identified_fees_exceed_gap():
    from app.services.pnl_statement import build_pnl_statement
    stmt = build_pnl_statement([
        {'net_units': 1, 'gross_units': 1, 'matched': True,
         'bank_settlement_projected': 95, 'commission_fee': 10}
    ], {'gross_sales': 100, 'net_sales': 100, 'bank_settlement': 95})
    amounts = {l['key']: l['amount'] for l in stmt['lines']}
    assert amounts['net_sales'] + amounts['commission'] == 90
    assert amounts['net_payout'] == 95


def test_report_detail_ignores_frozen_cost_basis():
    from app.routes.pnl import _build_sku_row_response
    from app.models.pnl import PnlSkuRow
    from app.services.pnl_statement import _cost_basis
    sp = SimpleNamespace(price=200, package=0, logistics=0, addons=0, misc_total=0,
        cr_percentage=0, cr_cost=0, damage_percentage=0, damage_cost=0,
        breakeven=200, gst=0, net_profit_amt=40, bank_settlement=240, profit_percentage=20)
    row = PnlSkuRow(id=1, report_id=1, company_id=1, platform_sku_name='AUDIT-SKU',
        sku_pricing_id=1, net_units=1, gross_units=1, snap_breakeven=100,
        snap_cogs_per_unit=100, casper_expected_bs=120)
    row.sku_pricing = SkuPricing(price=sp.price, package=0, logistics=0, addons=0,
        misc_total=0, cr_percentage=0, cr_cost=0, damage_percentage=0, damage_cost=0,
        breakeven=200, gst=0, net_profit_amt=40, bank_settlement=240, profit_percentage=20)
    detail = _build_sku_row_response(row)
    basis, frozen = _cost_basis(row)
    assert frozen and basis['breakeven'] == 100
    assert detail.casper_breakeven == 200 and detail.casper_expected_bs == 240


@pytest.mark.asyncio
async def test_invoice_count_sequence_reuses_existing_number(db):
    from app.services.billing import next_invoice_number
    year = date.today().year
    for n in (1, 3):  # invoice 2 was deleted
        db.add(Invoice(company_id=1, number=f'INV-{year}-{n:04d}',
            invoice_date=date.today(), customer_name='Audit'))
    await db.commit()
    assert await next_invoice_number(db, 1) == f'INV-{year}-0003'


@pytest.mark.asyncio
async def test_fk_orders_upload_uses_another_company_platform(client, db, monkeypatch):
    import app.services.fraud as fraud
    monkeypatch.setattr(fraud, 'extract_order_events_fk_orders',
        lambda _: [{'sku_platform_name': 'FOREIGN-SKU', 'order_status': 'RETURNED'}])
    async def noop(*args, **kwargs):
        return None
    for name in ('compute_return_reason_clusters', 'compute_state_risk_profiles',
                 'compute_actor_risk_profiles'):
        monkeypatch.setattr(fraud, name, noop)
    r = await client.post('/api/v1/pnl/upload/fk-orders',
        headers={'Authorization': f"Bearer {create_access_token({'sub': '2'})}",
                 'X-Company-Id': '2'},
        files={'file': ('orders.xlsx', b'audit', 'application/octet-stream')})
    assert r.status_code == 200
    from app.models.fraud import OrderEvent
    stored = (await db.execute(select(OrderEvent))).scalar_one()
    assert stored.company_id == 2 and stored.platform_id == 1


@pytest.mark.asyncio
async def test_backfill_can_reprocess_foreign_report(client, db, monkeypatch, tmp_path):
    from app.models.pnl import PnlReport
    import app.services.fraud as fraud
    db.add(PnlReport(id=50, company_id=2, platform_id=2, uploaded_by=2,
        filename='foreign.xlsx', period_start=date(2026, 1, 1), period_end=date(2026, 1, 31)))
    await db.commit()
    monkeypatch.chdir(tmp_path)
    folder = tmp_path / 'uploads' / 'pnl'
    folder.mkdir(parents=True)
    (folder / '50.xlsx').write_bytes(b'audit')
    monkeypatch.setattr(fraud, 'extract_order_events_fk', lambda _: [])
    async def noop(*args, **kwargs):
        return None
    for name in ('compute_sku_risk_scores', 'compute_return_reason_clusters',
                 'compute_state_risk_profiles', 'compute_actor_risk_profiles', 'generate_fraud_alerts'):
        monkeypatch.setattr(fraud, name, noop)
    r = await client.post('/api/v1/fraud/backfill/50')
    assert r.status_code == 200 and r.json()['reprocessed'] is True


def test_two_pricing_engines_use_different_rounding():
    from app.services.pricing import calculate_pricing as direct
    from app.services.entries import calculate_pricing as batch
    values = dict(price=90.5, package=0, logistics=0, addons=0, misc_total=0,
                  cr_cost=0, damage_cost=0, profit_percentage=20)
    a = direct(**values, gst=5)
    b = batch(**values, cr_percentage=0, damage_percentage=0, gst_rate=5)
    assert a['bank_settlement'] == 114.45
    assert b['bank_settlement'] == 114.03


@pytest.mark.asyncio
async def test_pnl_rows_adds_gst_rate_as_rupees(db):
    from app.models.pnl import PnlReport, PnlSkuRow
    from app.services.pnl_statement import compute_pnl_rows
    db.add(PnlReport(id=60, company_id=1, platform_id=1, uploaded_by=1,
        filename='gst.xlsx', period_start=date(2026, 1, 1), period_end=date(2026, 1, 31)))
    await db.flush()
    db.add(PnlSkuRow(report_id=60, company_id=1, sku_pricing_id=1,
        platform_sku_name='AUDIT-SKU', gross_units=1, net_units=1,
        bank_settlement_projected=300, snap_breakeven=200,
        snap_cogs_per_unit=200, snap_gst=18))
    await db.commit()
    result = await compute_pnl_rows(db, 60, 1)
    assert result['rows'][0]['casper_breakeven_gst'] == 218  # correct rate math: 236


@pytest.mark.asyncio
async def test_clearing_platform_override_does_not_clear_database(db):
    from app.models.sku import SkuPlatformConfig
    from app.schemas.entries import PlatformOverride
    from app.services.entries import _upsert_platform_configs
    cfg = SkuPlatformConfig(company_id=1, sku_pricing_id=1, platform_id=1,
                            ad_pct=10, platform_sku_name='OLD-ALIAS')
    db.add(cfg)
    await db.commit()
    await _upsert_platform_configs(db, await db.get(SkuPricing, 1),
                                  [PlatformOverride(platform_id=1)])
    await db.commit()
    assert cfg.ad_pct == 10 and cfg.platform_sku_name == 'OLD-ALIAS'


@pytest.mark.asyncio
async def test_batch_reports_saved_rows_but_transaction_cannot_commit(db):
    from app.services.entries import upsert_batch
    from app.schemas.entries import EntryRowInput
    from sqlalchemy.exc import PendingRollbackError
    saved, errors = await upsert_batch(db, [
        EntryRowInput(sku='GOOD', price=100),
        EntryRowInput(sku='BAD', price=100, vendor_id=99999),
    ], 1)
    assert len(saved) == 1 and len(errors) == 1
    with pytest.raises(PendingRollbackError):
        await db.commit()
    await db.rollback()


def test_paid_status_hides_unpaid_balance():
    from app.services.billing import build_billing_summary
    result = build_billing_summary([
        {'status': 'paid', 'total': 100, 'amount_paid': 0, 'due_date': None}
    ], date(2026, 1, 1))
    assert result['outstanding'] == 0 and result['total_paid'] == 0
