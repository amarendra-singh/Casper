from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, get_active_company, require_admin_or_above, get_company_scope
from app.models.user import User
from app.models.billing import Invoice, InvoiceLine
from app.schemas.billing import (
    InvoiceCreate, InvoiceUpdate, InvoiceResponse, InvoiceLineOut, InvoiceSummary,
)
from app.services.billing import (
    recalc_totals, next_invoice_number, compute_billing_summary, derive_status,
)

router = APIRouter(prefix="/billing", tags=["Billing"])


def _to_response(inv: Invoice) -> InvoiceResponse:
    return InvoiceResponse(
        id=inv.id, number=inv.number, invoice_date=inv.invoice_date, due_date=inv.due_date,
        customer_name=inv.customer_name, customer_gstin=inv.customer_gstin,
        status=derive_status(inv.status, inv.due_date, date.today()),
        gst_pct=inv.gst_pct, subtotal=inv.subtotal, tax_amount=inv.tax_amount, total=inv.total,
        amount_paid=inv.amount_paid, balance=round(inv.total - inv.amount_paid, 2),
        bank_name=inv.bank_name, notes=inv.notes,
        lines=[InvoiceLineOut.model_validate(ln) for ln in inv.lines],
        created_at=inv.created_at,
    )


async def _get_owned(db, invoice_id, company_id) -> Invoice:
    inv = (await db.execute(
        select(Invoice).options(selectinload(Invoice.lines))
        .where(Invoice.id == invoice_id, Invoice.company_id == company_id)
    )).scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return inv


@router.get("/", response_model=list[InvoiceResponse])
async def list_invoices(
    db: AsyncSession = Depends(get_db),
    scope=Depends(get_company_scope),
    _=Depends(get_current_user),
    status_filter: Optional[str] = Query(None, alias="status"),
):
    q = (select(Invoice).options(selectinload(Invoice.lines))
         .where(Invoice.company_id == scope.ids)
         .order_by(Invoice.invoice_date.desc(), Invoice.id.desc()))
    invoices = (await db.execute(q)).scalars().all()
    out = [_to_response(i) for i in invoices]
    if status_filter:
        out = [r for r in out if r.status == status_filter]
    return out


@router.get("/summary", response_model=InvoiceSummary)
async def billing_summary(
    db: AsyncSession = Depends(get_db),
    scope=Depends(get_company_scope),
    _=Depends(get_current_user),
):
    return await compute_billing_summary(db, scope.ids)


@router.get("/{invoice_id}", response_model=InvoiceResponse)
async def get_invoice(
    invoice_id: int,
    db: AsyncSession = Depends(get_db),
    scope=Depends(get_company_scope),
    _=Depends(get_current_user),
):
    return _to_response(await _get_owned(db, invoice_id, scope.ids))


@router.post("/", response_model=InvoiceResponse, status_code=status.HTTP_201_CREATED)
async def create_invoice(
    payload: InvoiceCreate,
    db: AsyncSession = Depends(get_db),
    company=Depends(get_active_company),
    user: User = Depends(require_admin_or_above),
):
    inv = Invoice(
        company_id=company.id, created_by=user.id,
        number=payload.number or await next_invoice_number(db, company.id),
        invoice_date=payload.invoice_date, due_date=payload.due_date,
        customer_name=payload.customer_name, customer_gstin=payload.customer_gstin,
        status=payload.status, gst_pct=payload.gst_pct, amount_paid=payload.amount_paid,
        bank_name=payload.bank_name, notes=payload.notes,
    )
    inv.lines = [InvoiceLine(description=l.description, sku_id=l.sku_id,
                             quantity=l.quantity, unit_price=l.unit_price) for l in payload.lines]
    recalc_totals(inv)
    db.add(inv)
    await db.commit()
    inv = await _get_owned(db, inv.id, company.id)
    return _to_response(inv)


@router.patch("/{invoice_id}", response_model=InvoiceResponse)
async def update_invoice(
    invoice_id: int,
    payload: InvoiceUpdate,
    db: AsyncSession = Depends(get_db),
    company=Depends(get_active_company),
    _: User = Depends(require_admin_or_above),
):
    inv = await _get_owned(db, invoice_id, company.id)
    data = payload.model_dump(exclude_unset=True)
    lines = data.pop("lines", None)
    for k, v in data.items():
        setattr(inv, k, v)
    if lines is not None:
        inv.lines.clear()
        for l in lines:
            inv.lines.append(InvoiceLine(description=l["description"], sku_id=l.get("sku_id"),
                                         quantity=l.get("quantity", 1), unit_price=l.get("unit_price", 0)))
    recalc_totals(inv)
    await db.commit()
    inv = await _get_owned(db, invoice_id, company.id)
    return _to_response(inv)


@router.delete("/{invoice_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_invoice(
    invoice_id: int,
    db: AsyncSession = Depends(get_db),
    company=Depends(get_active_company),
    _: User = Depends(require_admin_or_above),
):
    inv = await _get_owned(db, invoice_id, company.id)
    await db.delete(inv)
    await db.commit()
