"""Conflict-checked reversal of supported financial edits, recorded as new history."""
from datetime import date, datetime
from fastapi import HTTPException
from sqlalchemy import select, Date, DateTime
from app.models.audit import FinancialChange
from app.models.sku import SkuPricing
from app.models.ledger import LedgerEntry
from app.models.purchase import PurchaseBill

MODELS = {'sku_pricing': SkuPricing, 'ledger_entries': LedgerEntry}


def undo_candidate(change):
    return (change.action == 'update' and change.entity_type in MODELS
            and bool(change.before) and bool(change.after) and change.before != change.after)


async def undo_change(db, change):
    if not undo_candidate(change):
        raise HTTPException(409, 'This change requires its original workflow to reverse safely')
    model = MODELS[change.entity_type]
    record = await db.scalar(select(model).where(model.id == change.entity_id,
        model.company_id == change.company_id).with_for_update())
    if record is None:
        raise HTTPException(409, 'The original record no longer exists')
    latest = await db.scalar(select(FinancialChange.id).where(
        FinancialChange.company_id == change.company_id,
        FinancialChange.entity_type == change.entity_type,
        FinancialChange.entity_id == change.entity_id).order_by(FinancialChange.id.desc()).limit(1))
    if latest != change.id:
        raise HTTPException(409, 'A newer change exists. Review it before undoing')
    if change.entity_type == 'ledger_entries' and await db.scalar(select(PurchaseBill.id).where(
        PurchaseBill.ledger_entry_id == record.id, PurchaseBill.company_id == change.company_id).limit(1)):
        raise HTTPException(409, 'Reverse generated entries through their supplier bill')
    if change.entity_type == 'ledger_entries':
        from app.services.receipts import receipt_source
        if await receipt_source(db, record.id):
            raise HTTPException(409, 'Reverse this receipt through its invoice')
    for key, value in change.after.items():
        current = getattr(record, key)
        if isinstance(current, (date, datetime)):
            current = current.isoformat()
        if current != value:
            raise HTTPException(409, 'Record has changed since this history entry; refresh and retry')
    # Identity changes cannot be safely reversed as ordinary cost edits.
    protected = {'id', 'company_id', 'sku_id', 'platform_id'} if change.entity_type == 'sku_pricing' else {'id', 'company_id'}
    for key in protected:
        if change.before.get(key) != change.after.get(key):
            raise HTTPException(409, 'This edit changes record identity and needs manual reconciliation')
    from app.services.tenant_refs import validate_references
    try:
        await validate_references(db, change.company_id, change.before)
    except ValueError as exc:
        raise HTTPException(409, "A referenced record is no longer available; reconcile this edit manually") from exc
    for key, value in change.before.items():
        if key in protected or value == change.after.get(key):
            continue
        column = model.__table__.columns[key]
        if value is not None and isinstance(column.type, DateTime):
            value = datetime.fromisoformat(value)
        elif value is not None and isinstance(column.type, Date):
            value = date.fromisoformat(value)
        setattr(record, key, value)
    # Restore the exact previous financial state, not today's changed defaults.
    # Frozen reports are intentionally not restated by this edit reversal.
    await db.commit()
    return {'ok': True, 'undone_change_id': change.id}
