from datetime import date
import pytest
from sqlalchemy import select, func
from tests.test_audit_regressions import db, client  # noqa: F401
from app.models.billing import Invoice
from app.models.company import CompanyMembership, CompanyRole
from app.models.ledger import LedgerEntry
from app.models.receipt import InvoiceReceipt
from app.routes.billing import ReceiptInput
from app.services.receipts import record_receipt, reverse_receipt


async def invoice(db):
    inv = Invoice(company_id=1, number='RECEIPT-TEST', invoice_date=date(2026, 1, 1),
        customer_name='Synthetic', total=100, subtotal=100, status='sent', amount_paid=0)
    db.add(inv); await db.commit()
    return inv


@pytest.mark.asyncio
async def test_receipt_and_reversal_are_atomic_idempotent_and_retain_evidence(db):
    inv = await invoice(db)
    payload = ReceiptInput(amount=40, receipt_date=date(2026, 1, 2), payment_method='upi', request_key='same-request')
    receipt = await record_receipt(db, 1, inv.id, payload, 1)
    assert inv.amount_paid == 40 and inv.status == 'sent'
    repeated = await record_receipt(db, 1, inv.id, payload, 1)
    assert repeated.id == receipt.id and inv.amount_paid == 40
    assert await db.scalar(select(func.count()).select_from(LedgerEntry)) == 1
    with pytest.raises(ValueError, match='different receipt'):
        await record_receipt(db, 1, inv.id, payload.model_copy(update={'amount': 41}), 1)
    with pytest.raises(ValueError, match='outstanding'):
        await record_receipt(db, 1, inv.id, payload.model_copy(update={'amount': 61, 'request_key': 'second-request'}), 1)
    await reverse_receipt(db, 1, receipt.id, date(2026, 1, 3), 1)
    await reverse_receipt(db, 1, receipt.id, date(2026, 1, 3), 1)
    assert inv.amount_paid == 0 and inv.status == 'sent'
    rows = (await db.scalars(select(LedgerEntry).order_by(LedgerEntry.id))).all()
    assert [(r.direction, r.amount) for r in rows] == [('income', 40), ('expense', 40)]
    assert await db.scalar(select(func.count()).select_from(InvoiceReceipt)) == 1


@pytest.mark.asyncio
async def test_receipt_routes_guard_tenant_role_and_generated_ledger(client, db):
    inv = await invoice(db)
    body = {'amount': 100, 'receipt_date': '2026-01-02', 'payment_method': 'cash', 'request_key': 'route-request'}
    url = f'/api/v1/billing/{inv.id}/receipts'
    assert (await client.post(url, json=body)).status_code == 403
    member = await db.scalar(select(CompanyMembership).where(CompanyMembership.company_id == 1, CompanyMembership.user_id == 1))
    member.role = CompanyRole.owner; await db.commit()
    result = await client.post(url, json=body)
    assert result.status_code == 200, result.text
    receipt = await db.get(InvoiceReceipt, result.json()['id'])
    assert inv.status == 'paid'
    listed = await client.get('/api/v1/ledger/')
    assert listed.status_code == 200
    assert next(row for row in listed.json() if row['id'] == receipt.ledger_entry_id)['source_type'] == 'invoice_receipt'
    assert (await client.patch(f'/api/v1/ledger/{receipt.ledger_entry_id}', json={'amount': 999})).status_code == 409
    assert (await client.delete(f'/api/v1/ledger/{receipt.ledger_entry_id}')).status_code == 409
    assert (await client.post('/api/v1/billing/999/receipts', json=body)).status_code == 404
