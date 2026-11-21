from datetime import date

import pytest
from sqlalchemy import select
from tests.test_audit_regressions import db, client  # noqa: F401
from app.models.sku import Sku
from app.models.purchase import PurchaseBill, PurchaseBillLine
from app.models.ledger import LedgerEntry
from app.services.purchase import save_bills, suggest_sku, link_line


def parsed_bill(ref, name='AMORE WHISKY', txn_type='Sale'):
    return {'ref_no': ref, 'date': '01/10/2026', 'txn_type': txn_type, 'total': 100,
            'items': [{'name': name, 'amount': 100, 'price_unit': 100}]}


@pytest.mark.asyncio
async def test_named_supplier_confirmation_propagates_and_survives_reupload(db):
    from app.services.purchase import bills_view
    await save_bills(db, 1, None, 'Supplier A', [parsed_bill('1'), parsed_bill('2')], 'fixture')
    await save_bills(db, 1, None, 'Supplier B', [parsed_bill('3')], 'fixture')
    rows = await bills_view(db, 1, None)
    first = next(b for b in rows if b['ref_no'] == '1')['lines'][0]
    await link_line(db, 1, first['id'], 1, 6, True)
    rows = {b['ref_no']: b for b in await bills_view(db, 1, None)}
    assert rows['2']['lines'][0]['sku_id'] == 1
    assert rows['2']['lines'][0]['pack_multiple'] == 6
    assert rows['3']['lines'][0]['sku_id'] is None
    await save_bills(db, 1, None, 'Supplier A', [parsed_bill('1'), parsed_bill('4', '  amore   whisky ')], 'fixture')
    rows = {b['ref_no']: b for b in await bills_view(db, 1, None)}
    assert rows['1']['lines'][0]['pack_multiple'] == 6
    assert rows['4']['lines'][0]['sku_id'] == 1
    assert rows['4']['lines'][0]['pack_multiple'] == 6


@pytest.mark.asyncio
async def test_manual_match_without_remember_survives_same_bill_reupload(db):
    from app.services.purchase import bills_view
    await save_bills(db, 1, None, 'Supplier', [parsed_bill('1')], 'fixture')
    line = (await bills_view(db, 1, None))[0]['lines'][0]
    await link_line(db, 1, line['id'], 1, 6, False)
    await save_bills(db, 1, None, 'Supplier', [parsed_bill('1')], 'fixture')
    line = (await bills_view(db, 1, None))[0]['lines'][0]
    assert (line['sku_id'], line['pack_multiple'], line['match_source']) == (1, 6, 'manual')


@pytest.mark.asyncio
async def test_existing_bill_candidates_are_computed_without_reupload_or_cost_writes(db):
    from app.services.purchase import bills_view
    await save_bills(db, 1, None, 'Supplier', [parsed_bill('1', 'CELLO BRILLIANT 325 ML')], 'fixture')
    sku = await db.get(Sku, 1)
    sku.vendor_sku = 'BRILLIANT'
    db.add(Sku(company_id=1, shringar_sku='BRL-P6', vendor_sku='BRILLIANT'))
    await db.commit()
    line = (await bills_view(db, 1, None))[0]['lines'][0]
    assert len(line['candidates']) == 2
    assert line['sku_id'] is None
    assert line['cost_diff'] is None


@pytest.mark.asyncio
async def test_payment_and_credit_rows_are_not_posted_as_new_expenses(db):
    result = await save_bills(db, 1, None, 'Supplier', [parsed_bill('1'),
        parsed_bill('2', txn_type='Payment-Out'), parsed_bill('3', txn_type='Credit Note')], 'fixture')
    assert result['skipped_transactions'] == 2
    assert len((await db.scalars(select(LedgerEntry))).all()) == 1


@pytest.mark.asyncio
async def test_auto_match_endpoint_denies_viewers(client):
    response = await client.post('/api/v1/billing/purchase-bills/auto-match')
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_reupload_response_has_corrected_line_values(db):
    from app.services.purchase import bills_view
    await save_bills(db, 1, None, 'Supplier', [parsed_bill('1')], 'fixture')
    corrected = parsed_bill('1')
    corrected['items'][0]['price_unit'] = 200
    corrected['items'][0]['amount'] = 200
    corrected['total'] = 200
    await save_bills(db, 1, None, 'Supplier', [corrected], 'fixture')
    row = (await bills_view(db, 1, None))[0]
    assert row['total'] == row['lines'][0]['price_unit'] == 200
    assert len(row['lines']) == 1


@pytest.mark.asyncio
async def test_cleared_match_does_not_return_on_auto_match(db):
    from app.services.purchase import bills_view, rematch_bills
    await save_bills(db, 1, None, 'Supplier', [parsed_bill('1')], 'fixture')
    line = (await bills_view(db, 1, None))[0]['lines'][0]
    await link_line(db, 1, line['id'], 1, 6, True)
    await link_line(db, 1, line['id'], None, 6, True)
    assert await rematch_bills(db, 1) == 0
    assert (await bills_view(db, 1, None))[0]['lines'][0]['sku_id'] is None


@pytest.mark.asyncio
@pytest.mark.parametrize('method', ['patch', 'delete'])
async def test_supplier_ledger_entry_cannot_be_changed_independently(client, db, method):
    from app.models.company import CompanyMembership, CompanyRole
    membership = await db.scalar(select(CompanyMembership).where(CompanyMembership.company_id == 1, CompanyMembership.user_id == 1))
    membership.role = CompanyRole.owner
    await db.commit()
    await save_bills(db, 1, None, 'Supplier', [parsed_bill('1')], 'fixture')
    entry = await db.scalar(select(LedgerEntry))
    response = await client.request(method, f'/api/v1/ledger/{entry.id}', **({'json': {'amount': 999}} if method == 'patch' else {}))
    assert response.status_code == 409
    await db.refresh(entry)
    assert entry.amount == 100


@pytest.mark.asyncio
async def test_platform_in_use_returns_actionable_conflict(client, db):
    from app.models.company import CompanyMembership, CompanyRole
    membership = await db.scalar(select(CompanyMembership).where(CompanyMembership.company_id == 1, CompanyMembership.user_id == 1))
    membership.role = CompanyRole.owner
    await db.commit()
    response = await client.delete('/api/v1/platforms/1')
    assert response.status_code == 409
    assert 'Deactivate' in response.json()['detail']


@pytest.mark.asyncio
async def test_registering_named_supplier_does_not_duplicate_its_bills(db):
    from app.models.vendor import Vendor
    await save_bills(db, 1, None, 'Supplier', [parsed_bill('1')], 'fixture')
    db.add(Vendor(id=3, company_id=1, name='Supplier', short_code='SUP'))
    await db.commit()
    result = await save_bills(db, 1, 3, 'Supplier', [parsed_bill('1')], 'fixture')
    assert result['bills_updated'] == 1 and result['bills_created'] == 0
    assert len((await db.scalars(select(LedgerEntry))).all()) == 1


@pytest.mark.asyncio
async def test_sku_api_returns_search_fields_without_cross_company_records(client, db):
    sku = await db.get(Sku, 1)
    sku.vendor_sku = 'AMORE WHISKY'
    sku.description = 'Crystal tumbler'
    await db.commit()
    response = await client.get('/api/v1/skus/')
    assert response.status_code == 200
    assert [s['id'] for s in response.json()] == [1]
    assert response.json()[0]['description'] == 'Crystal tumbler'
    assert response.json()[0]['vendor_sku'] == 'AMORE WHISKY'


def test_equal_pack_candidates_do_not_choose_an_arbitrary_variant():
    assert suggest_sku('AMORE WHISKY 325', {
        1: ('AMR-P1', {'AMORE', 'WHISKY', '325'}),
        2: ('AMR-P6', {'AMORE', 'WHISKY', '325'}),
    }) == (None, 0)


@pytest.mark.asyncio
async def test_supplier_suggestions_use_vendor_names_and_descriptions_without_posting_guesses(db):
    sku = await db.get(Sku, 1)
    sku.vendor_sku = 'AMORE WHISKY'
    sku.description = 'Crystal tumbler'
    await db.commit()
    await save_bills(db, 1, None, 'Synthetic supplier', [{
        'ref_no': 'matching-fixture', 'date': '01/10/2026', 'total': 100,
        'items': [{'name': 'AMORE WHISKY', 'amount': 100, 'price_unit': 100}],
    }], 'fixture.pdf')
    line = await db.scalar(select(PurchaseBillLine))
    assert line.sku_id == 1
    assert line.match_source == 'suggested'
    entry = await db.scalar(select(LedgerEntry))
    assert entry.sku_id is None


@pytest.mark.asyncio
async def test_manual_line_link_updates_single_sku_ledger_only_when_every_line_is_confirmed(db):
    entry = LedgerEntry(company_id=1, entry_date=date(2026, 10, 1), direction='expense', category='inventory', amount=100)
    db.add(entry)
    await db.flush()
    bill = PurchaseBill(company_id=1, supplier_key='party:FIXTURE', ref_no='fixture', bill_date=date(2026, 10, 1), ledger_entry_id=entry.id)
    db.add(bill)
    await db.flush()
    lines = [PurchaseBillLine(bill_id=bill.id, line_no=i, item_name='Fixture', match_source='none', pack_multiple=1) for i in (1, 2)]
    db.add_all(lines)
    await db.commit()
    await link_line(db, 1, lines[0].id, 1, 1, False)
    await db.refresh(entry)
    assert entry.sku_id is None
    await link_line(db, 1, lines[1].id, 1, 1, False)
    await db.refresh(entry)
    assert entry.sku_id == 1
    await link_line(db, 1, lines[0].id, None, 1, False)
    await db.refresh(entry)
    assert entry.sku_id is None
