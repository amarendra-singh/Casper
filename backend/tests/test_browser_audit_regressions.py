"""Regression tests for independently reproduced browser/business failures.
All writes use the foreign-key-enforced in-memory fixture, never company data.
"""
from datetime import date
import pytest
from pydantic import ValidationError
from sqlalchemy import select
from tests.test_audit_regressions import db, client  # noqa: F401
from app.models.company import CompanyMembership, CompanyRole
from app.models.fraud import OrderEvent, ActorRiskProfile
from app.models.pnl import PnlReport
from app.models.sku import SkuPricing
from app.schemas.platform import PlatformCreate, PlatformTierCreate
from app.services.fraud import (compute_actor_risk_profiles, compute_return_reason_clusters,
                                compute_state_risk_profiles, get_fraud_dashboard)
from app.services.pnl import check_duplicate, parse_and_store
from app.services.pnl_statement import quick_add_hidden_sku
from app.services.operations import build_operations


@pytest.mark.asyncio
async def test_fraud_rebuild_preserves_outer_transaction_and_signal_identity(db):
    for signal in ('FRAUD_SIGNAL', 'QUALITY'):
        db.add(OrderEvent(company_id=1, platform_id=1, sku_platform_name='AUDIT-SKU',
                          order_status='RETURNED', return_reason='MISSING',
                          customer_state_name='MH', customer_state_code='MH',
                          fraud_signal_type=signal))
    await db.flush()
    for _ in range(2):
        async with db.begin_nested():
            await compute_return_reason_clusters(db, 1)
            await compute_state_risk_profiles(db, 1)
            await compute_actor_risk_profiles(db, 1)
            actors = (await db.scalars(select(ActorRiskProfile))).all()
            assert len(actors) == 2
            assert len({actor.actor_key for actor in actors}) == 2
    await db.rollback()
    assert (await db.scalars(select(OrderEvent))).all() == []


@pytest.mark.asyncio
async def test_real_import_risk_chain_can_finish_with_empty_orders(db, monkeypatch):
    import app.services.pnl as pnl
    monkeypatch.setattr(pnl, '_parse_meesho_workbook', lambda _: ({'bank_settlement': 450}, []))
    monkeypatch.setattr(pnl, 'extract_order_events_meesho', lambda _: [])
    result = await parse_and_store(db, b'synthetic-parser-input', 'fixture.xlsx', 1, 1,
                                  date(2026, 1, 1), date(2026, 1, 31), 1, 'meesho')
    report = await db.get(PnlReport, result.report_id)
    assert result.parse_warnings == []
    assert report.status == 'done'
    await db.rollback()
    assert await db.get(PnlReport, result.report_id) is None


@pytest.mark.asyncio
@pytest.mark.parametrize('gst', [0, 5, 18])
async def test_missing_cost_recovery_preserves_existing_tax_and_overrides(db, gst):
    pricing = await db.get(SkuPricing, 1)
    pricing.gst = gst
    pricing.damage_cost_override = 7
    pricing.damage_cost = 7
    pricing.misc_total_override = 11
    pricing.misc_total = 11
    db.add(PnlReport(id=91, company_id=1, platform_id=1, period_start=date(2026, 1, 1),
                     period_end=date(2026, 1, 31), filename='fixture', uploaded_by=1))
    await db.commit()
    result = await quick_add_hidden_sku(db, 1, 91, 'AUDIT-SKU', 123)
    assert result['created']
    await db.refresh(pricing)
    assert pricing.gst == gst
    assert pricing.damage_cost_override == 7
    assert pricing.misc_total_override == 11
    assert pricing.price == 123


@pytest.mark.asyncio
async def test_missing_cost_recovery_rolls_back_when_rematch_fails(db, monkeypatch):
    import app.services.pnl_statement as statement
    db.add(PnlReport(id=92, company_id=1, platform_id=1, period_start=date(2026, 2, 1),
                     period_end=date(2026, 2, 28), filename='fixture', uploaded_by=1))
    await db.commit()

    async def fail_rematch(*args):
        raise RuntimeError('Synthetic rematch failure')

    monkeypatch.setattr(statement, 'rematch_report', fail_rematch)
    with pytest.raises(RuntimeError, match='Synthetic rematch failure'):
        await quick_add_hidden_sku(db, 1, 92, 'AUDIT-SKU', 999)
    await db.rollback()
    pricing = await db.get(SkuPricing, 1)
    assert pricing.price == 100


@pytest.mark.asyncio
async def test_recovery_preserves_canonical_base_when_pricing_ids_differ(db):
    from app.models.platform import Platform
    db.add(Platform(id=3, company_id=1, name='Synthetic secondary', cr_charge=0, cr_percentage=0))
    await db.flush()
    old = await db.get(SkuPricing, 1)
    old.platform_id = 3
    old.gst = 5
    db.add(SkuPricing(id=3, company_id=1, sku_id=1, platform_id=1, price=100, gst=18,
                      cr_percentage=0, cr_cost=0, damage_percentage=0, damage_cost=0))
    db.add(PnlReport(id=93, company_id=1, platform_id=1, period_start=date(2026, 3, 1),
                     period_end=date(2026, 3, 31), filename='fixture', uploaded_by=1))
    await db.commit()
    assert (await quick_add_hidden_sku(db, 1, 93, 'AUDIT-SKU', 123))['created']
    canonical = await db.get(SkuPricing, 3)
    await db.refresh(canonical)
    assert canonical.gst == 18
    assert canonical.price == 123


@pytest.mark.asyncio
async def test_payout_insight_accepts_unknown_margin_but_excludes_zero_gmv(db):
    from app.models.platform import Platform
    from app.routes.dashboard import _insight_platform_health
    db.add(Platform(id=3, company_id=1, name='No GMV', cr_charge=0, cr_percentage=0))
    await db.flush()
    for platform, gross, settlement in [(1, 1000, 700), (3, 0, 100)]:
        db.add(PnlReport(company_id=1, platform_id=platform, period_start=date(2026, 4, 1),
                         period_end=date(2026, 4, 30), filename='fixture', uploaded_by=1,
                         gross_sales=gross, bank_settlement=settlement, net_margin_pct=None))
    await db.flush()
    insight = await _insight_platform_health(db, 1)
    assert '70.0%' in insight['title']
    assert 'Add more platforms' in insight['body']


@pytest.mark.asyncio
async def test_invalid_hidden_sku_reference_is_validation_error(client, db):
    membership = await db.scalar(select(CompanyMembership).where(
        CompanyMembership.company_id == 1, CompanyMembership.user_id == 1))
    membership.role = CompanyRole.owner
    await db.commit()
    response = await client.post('/api/v1/pnl/hidden-skus/add', json={
        'platform_sku_name': 'SYNTHETIC', 'report_id': 91, 'price': 100, 'vendor_id': 'invalid',
    })
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_fraud_dashboard_accepts_single_and_multiple_company_scopes(db):
    for scope in (1, [1], [1, 2]):
        result = await get_fraud_dashboard(db, scope)
        assert result['sku_risk_table'] == []


@pytest.mark.asyncio
async def test_overlapping_periods_are_detected_but_tenants_remain_separate(db):
    db.add(PnlReport(company_id=1, platform_id=1, period_start=date(2026, 1, 1),
                     period_end=date(2026, 1, 31), filename='fixture', uploaded_by=1))
    await db.flush()
    assert await check_duplicate(db, 1, date(2026, 1, 20), date(2026, 2, 15), 1)
    assert not await check_duplicate(db, 1, date(2026, 2, 1), date(2026, 2, 28), 1)
    assert not await check_duplicate(db, 2, date(2026, 1, 1), date(2026, 1, 31), 2)


@pytest.mark.parametrize('field,value', [('name', ' '), ('cr_charge', -1), ('cr_percentage', 101),
                                        ('default_ad_pct', -1), ('target_monthly_units', 0)])
def test_impossible_settings_rejected(field, value):
    payload = dict(name='Valid', cr_charge=0, cr_percentage=0)
    payload[field] = value
    with pytest.raises(ValidationError):
        PlatformCreate(**payload)
    with pytest.raises(ValidationError):
        PlatformTierCreate(tier_name='Valid', fee=float('nan'))


def test_waterfall_discloses_credit_adjustment_and_reconciles():
    result = build_operations({}, dict(gross_sales=1000, commission=150,
                                       total_expenses=-100, bank_settlement=900), [], [])
    bridge = sum(row['value'] * (-1 if row['kind'] == 'neg' else 1)
                 for row in result['fees'] if row['kind'] != 'settle')
    assert bridge == 900
    assert result['summary']['return_rate'] is None


@pytest.mark.asyncio
async def test_paid_invoice_is_preserved_and_sent_invoice_can_receive_payment(client, db):
    membership = await db.scalar(select(CompanyMembership).where(
        CompanyMembership.company_id == 1, CompanyMembership.user_id == 1))
    membership.role = CompanyRole.owner
    await db.commit()
    response = await client.post('/api/v1/billing/', json={
        'invoice_date': '2026-01-01', 'customer_name': 'Synthetic', 'status': 'sent',
        'lines': [{'description': 'Fixture', 'quantity': 1, 'unit_price': 100}]})
    assert response.status_code == 201, response.text
    invoice_id = response.json()['id']
    url = f'/api/v1/billing/{invoice_id}'
    assert (await client.patch(url, json={'customer_name': 'Changed'})).status_code == 409
    assert (await client.patch(url, json={'status': 'paid', 'amount_paid': 100})).status_code == 409
    assert (await client.post(url + '/receipts', json={'amount': 100, 'receipt_date': '2026-01-02', 'payment_method': 'cash', 'request_key': 'synthetic-payment'})).status_code == 200
    assert (await client.delete(url)).status_code == 409
    assert (await client.patch(url, json={'notes': 'Payment reference fixture'})).status_code == 200


@pytest.mark.asyncio
async def test_meesho_workbook_upload_and_replacement_complete_entire_pipeline(db):
    from io import BytesIO
    import openpyxl
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = 'Order Payments'
    sheet.append(['Synthetic regression fixture'])
    sheet.append(['Sub Order No', 'Order Date', 'Payment Date', 'Supplier SKU',
                  'Live Order Status', 'Quantity', 'Total Sale Amount (Incl. Shipping & GST)',
                  'Total Sale Return Amount (Incl. Shipping & GST)', 'Final Settlement Amount',
                  'TCS', 'TDS', 'Shipping Charge (Incl. GST)', 'Return Shipping Charge (Incl. GST)'])
    sheet.append([])
    sheet.append(['SYNTHETIC-1', date(2026, 1, 1), date(2026, 1, 10), 'AUDIT-SKU',
                  'Delivered', 2, 500, 0, 450, 2, 1, 25, 0])
    output = BytesIO()
    workbook.save(output)
    arguments = dict(session=db, file_bytes=output.getvalue(), filename='synthetic.xlsx',
                     platform_id=1, uploaded_by=1, company_id=1, platform_name='meesho',
                     period_start=date(2026, 1, 1), period_end=date(2026, 1, 31))
    first = await parse_and_store(**arguments)
    assert first.parse_warnings == []
    await db.commit()
    assert (await db.get(PnlReport, first.report_id)).bank_settlement == 450
    second = await parse_and_store(**arguments, replace_report_id=first.report_id)
    assert second.parse_warnings == []
    await db.commit()
    assert len((await db.scalars(select(PnlReport))).all()) == 1
    assert (await db.get(PnlReport, second.report_id)).status == 'done'


@pytest.mark.asyncio
async def test_legacy_overlaps_are_excluded_with_explicit_coverage_warning(db):
    from app.services.pnl import get_dashboard_summary
    from app.services.operations import compute_operations
    for start, end, amount in ((date(2026, 1, 1), date(2026, 1, 31), 900),
                               (date(2026, 1, 1), date(2026, 2, 28), 1350)):
        db.add(PnlReport(company_id=1, platform_id=1, period_start=start, period_end=end,
                         filename='fixture', uploaded_by=1, bank_settlement=amount))
    await db.flush()
    dashboard = await get_dashboard_summary(db, 1)
    assert dashboard['total_bank_settlement'] == 0
    assert len(dashboard['excluded_report_ids']) == 2
    assert dashboard['coverage_warnings']
    assert (await compute_operations(db, 1))['summary']['settlement'] == 0


@pytest.mark.asyncio
async def test_void_unpaid_issued_invoice_retains_original_and_history(client, db):
    from app.models.audit import FinancialChange
    membership = await db.scalar(select(CompanyMembership).where(
        CompanyMembership.company_id == 1, CompanyMembership.user_id == 1))
    membership.role = CompanyRole.owner
    await db.commit()
    response = await client.post('/api/v1/billing/', json={
        'invoice_date': '2026-01-01', 'customer_name': 'Synthetic', 'status': 'sent',
        'lines': [{'description': 'Fixture', 'unit_price': 100}]})
    invoice_id = response.json()['id']
    url = f'/api/v1/billing/{invoice_id}'
    void = await client.patch(url, json={'status': 'cancelled'})
    assert void.status_code == 200, void.text
    assert void.json()['total'] == 100
    assert (await client.delete(url)).status_code == 409
    history = (await db.scalars(select(FinancialChange).where(
        FinancialChange.entity_type == 'invoices', FinancialChange.entity_id == invoice_id,
        FinancialChange.action == 'update'))).all()
    assert any(row.after['status'] == 'cancelled' for row in history)


@pytest.mark.asyncio
async def test_viewer_cannot_resolve_alert_or_reprocess_financial_source(client):
    assert (await client.patch('/api/v1/fraud/resolve/999')).status_code == 403
    assert (await client.post('/api/v1/fraud/backfill/999')).status_code == 403


@pytest.mark.asyncio
async def test_rto_does_not_include_customer_returns_or_cancellations(db):
    from app.models.pnl import PnlSkuRow
    from app.services.pnl import get_dashboard_summary
    report = PnlReport(company_id=1, platform_id=1, period_start=date(2026, 1, 1),
                       period_end=date(2026, 1, 31), filename='fixture', uploaded_by=1)
    db.add(report)
    await db.flush()
    db.add(PnlSkuRow(company_id=1, report_id=report.id, platform_sku_name='AUDIT-SKU',
                     gross_units=10, rto_units=2, rvp_units=3, cancelled_units=4, net_units=1))
    await db.flush()
    platform = (await get_dashboard_summary(db, 1))['platforms'][0]
    assert platform['rto_rate'] == 20
    assert platform['return_rate'] == 30
