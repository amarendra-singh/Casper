"""Read financial history within an authorized company scope."""

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.dependencies import get_company_scope, require_any, require_role_in_company
from app.models.audit import FinancialChange
from app.models.user import User
from app.services.undo import undo_candidate, undo_change

router = APIRouter(prefix="/change-history", tags=["Financial history"])


@router.get("/")
async def list_changes(
    db: AsyncSession = Depends(get_db),
    scope=Depends(get_company_scope),
    user: User = Depends(require_any),
    limit: int = Query(default=100, ge=1, le=500),
    before_id: int | None = None,
):
    for company_id in scope.ids:
        await require_role_in_company(db, user, company_id)
    query = select(FinancialChange).where(FinancialChange.company_id.in_(scope.ids))
    if before_id is not None:
        query = query.where(FinancialChange.id < before_id)
    rows = (await db.scalars(query.order_by(FinancialChange.id.desc()).limit(limit))).all()
    entity_ids = {row.entity_id for row in rows}
    latest = (await db.execute(select(FinancialChange.company_id, FinancialChange.entity_type,
        FinancialChange.entity_id, func.max(FinancialChange.id)).where(
        FinancialChange.company_id.in_(scope.ids), FinancialChange.entity_id.in_(entity_ids))
        .group_by(FinancialChange.company_id, FinancialChange.entity_type, FinancialChange.entity_id))).all()
    latest_ids = {item[3] for item in latest}
    from app.models.purchase import PurchaseBill
    from app.models.receipt import InvoiceReceipt
    generated = set((await db.scalars(select(PurchaseBill.ledger_entry_id).where(
        PurchaseBill.company_id.in_(scope.ids), PurchaseBill.ledger_entry_id.in_(entity_ids)))).all())
    receipts = (await db.execute(select(InvoiceReceipt.ledger_entry_id, InvoiceReceipt.reversal_entry_id).where(
        InvoiceReceipt.company_id.in_(scope.ids)))).all()
    generated.update(entry_id for receipt in receipts for entry_id in receipt if entry_id is not None)
    return [
        {**{column.key: getattr(row, column.key) for column in FinancialChange.__table__.columns},
         'undo_available': undo_candidate(row) and row.id in latest_ids and not (row.entity_type == 'ledger_entries' and row.entity_id in generated)} for row in rows
    ]


@router.post('/{change_id}/undo')
async def undo_financial_change(change_id: int, db: AsyncSession = Depends(get_db),
    scope=Depends(get_company_scope), user: User = Depends(require_any)):
    change = await db.scalar(select(FinancialChange).where(FinancialChange.id == change_id,
        FinancialChange.company_id.in_(scope.ids)))
    if change is None:
        raise HTTPException(404, 'Change not found')
    await require_role_in_company(db, user, change.company_id)
    return await undo_change(db, change)
