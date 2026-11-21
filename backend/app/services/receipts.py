from sqlalchemy import select, or_
from app.models.billing import Invoice
from app.models.ledger import LedgerEntry
from app.models.receipt import InvoiceReceipt
from app.services.pricing import money_round


async def receipt_source(db, entry_id):
    return await db.scalar(select(InvoiceReceipt.id).where(or_(
        InvoiceReceipt.ledger_entry_id == entry_id, InvoiceReceipt.reversal_entry_id == entry_id)).limit(1))


async def record_receipt(db, company_id, invoice_id, payload, user_id):
    invoice = await db.scalar(select(Invoice).where(Invoice.id == invoice_id,
        Invoice.company_id == company_id).with_for_update().execution_options(populate_existing=True))
    if invoice is None:
        raise ValueError('Invoice not found')
    existing = await db.scalar(select(InvoiceReceipt).where(InvoiceReceipt.company_id == company_id,
        InvoiceReceipt.request_key == payload.request_key))
    amount = money_round(payload.amount)
    if existing:
        expected = (invoice_id, amount, payload.receipt_date, payload.payment_method, payload.reference_no)
        actual = (existing.invoice_id, existing.amount, existing.receipt_date, existing.payment_method, existing.reference_no)
        if actual != expected:
            raise ValueError('This request key was already used for a different receipt')
        return existing
    if invoice.status not in ('sent', 'paid'):
        raise ValueError('Issue the invoice before recording a receipt')
    if amount <= 0 or amount > money_round(invoice.total - invoice.amount_paid):
        raise ValueError('Receipt must be positive and cannot exceed the outstanding balance')
    if payload.receipt_date < invoice.invoice_date:
        raise ValueError('Receipt date cannot precede the invoice; advances need separate reconciliation')
    entry = LedgerEntry(company_id=company_id, entry_date=payload.receipt_date, direction='income',
        category='sale', amount=amount, payment_method=payload.payment_method,
        reference_no=payload.reference_no, party_name=invoice.customer_name,
        note=f'Invoice receipt: {invoice.number}', created_by=user_id)
    db.add(entry); await db.flush()
    receipt = InvoiceReceipt(company_id=company_id, invoice_id=invoice_id, ledger_entry_id=entry.id,
        receipt_date=payload.receipt_date, amount=amount, request_key=payload.request_key,
        payment_method=payload.payment_method, reference_no=payload.reference_no)
    db.add(receipt)
    invoice.amount_paid = money_round(invoice.amount_paid + amount)
    invoice.status = 'paid' if invoice.amount_paid == invoice.total else 'sent'
    await db.commit()
    return receipt


async def reverse_receipt(db, company_id, receipt_id, reversal_date, user_id):
    receipt = await db.scalar(select(InvoiceReceipt).where(InvoiceReceipt.id == receipt_id,
        InvoiceReceipt.company_id == company_id).with_for_update().execution_options(populate_existing=True))
    if receipt is None:
        raise ValueError('Receipt not found')
    invoice = await db.scalar(select(Invoice).where(Invoice.id == receipt.invoice_id,
        Invoice.company_id == company_id).with_for_update().execution_options(populate_existing=True))
    if receipt.reversal_entry_id:
        return receipt
    if reversal_date < receipt.receipt_date:
        raise ValueError('Reversal cannot precede the receipt')
    if invoice.amount_paid < receipt.amount:
        raise ValueError('Invoice balance has changed; reconcile before reversing')
    reversal = LedgerEntry(company_id=company_id, entry_date=reversal_date, direction='expense',
        category='refund', amount=receipt.amount, payment_method=receipt.payment_method,
        reference_no=receipt.reference_no, party_name=invoice.customer_name,
        note=f'Reversal of receipt #{receipt.id}: {invoice.number}', created_by=user_id)
    db.add(reversal); await db.flush()
    receipt.reversal_entry_id = reversal.id
    invoice.amount_paid = money_round(invoice.amount_paid - receipt.amount)
    invoice.status = 'sent'
    await db.commit()
    return receipt
