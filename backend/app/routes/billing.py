from sqlalchemy.exc import IntegrityError
from app.core.dependencies import require_company_role
from app.models.company import CompanyRole
import io
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, Query, File, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, get_active_company, require_admin_or_above, get_company_scope, require_role_in_company, require_any
from app.services.scope import company_ids
from app.models.user import User
from app.models.billing import Invoice, InvoiceLine
from app.schemas.billing import (
    InvoiceCreate, InvoiceUpdate, InvoiceResponse, InvoiceLineOut, InvoiceSummary,
)
from app.services.billing import (
    recalc_totals, next_invoice_number, compute_billing_summary, derive_status,
)
from app.models.sku import Sku
from app.services.vendor_identity import resolve_vendor
from app.services.bill_discrepancy import (
    parse_flipkart_csv, parse_vyapar_pdf_text, build_report, detect_supplier,
)
from app.services.purchase import save_bills, bills_view, link_line, apply_cost, rematch_bills

router = APIRouter(prefix="/billing", tags=["Billing"])


def _to_response(inv: Invoice, co: dict | None = None) -> InvoiceResponse:
    r = InvoiceResponse(
        company_id=inv.company_id, id=inv.id, number=inv.number, invoice_date=inv.invoice_date, due_date=inv.due_date,
        customer_name=inv.customer_name, customer_gstin=inv.customer_gstin,
        status=derive_status(inv.status, inv.due_date, date.today()),
        gst_pct=inv.gst_pct, subtotal=inv.subtotal, tax_amount=inv.tax_amount, total=inv.total,
        amount_paid=inv.amount_paid, balance=round(inv.total - inv.amount_paid, 2),
        bank_name=inv.bank_name, notes=inv.notes,
        lines=[InvoiceLineOut.model_validate(ln) for ln in inv.lines],
        created_at=inv.created_at,
    )
    if co:
        r.company_id = inv.company_id
        r.company_name, r.company_color = co.get(inv.company_id, (None, None))
    return r

async def _company_meta(db, cids) -> dict:
    """{id: (name, colour)} — only looked up when the scope spans several companies,
    so single-company responses carry no company fields and no extra query."""
    from sqlalchemy import select as _select
    from app.models.company import Company
    rows = await db.execute(_select(Company.id, Company.name, Company.color).where(Company.id.in_(cids)))
    return {cid: (name, color) for cid, name, color in rows.all()}



async def _get_owned(db, invoice_id, company_id) -> Invoice:
    """Fetch one invoice, scoped. `company_id` may be a single id (writes) or the
    caller's whole scope (a consolidated read), so always match with IN."""
    inv = (await db.execute(
        select(Invoice).options(selectinload(Invoice.lines))
        .where(Invoice.id == invoice_id, Invoice.company_id.in_(company_ids(company_id)))
    )).scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return inv


@router.post("/discrepancies")
async def bill_discrepancies(
    orders_csv: Optional[UploadFile] = File(None),
    bills_pdf: Optional[UploadFile] = File(None),
    vendor: Optional[str] = Query(None, description="Supplier name; auto-detected from the PDF when omitted"),
    db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin)),
    _=Depends(require_any),
):
    """
    Parse a Flipkart order export and/or a Vyapar party statement.

    Orders are reported as-is (they are sales, and nothing about them is
    stored). Bills are supplier purchases, so they ARE persisted — that is what
    lets SKU links, aliases and applied costs survive the upload.
    """
    if orders_csv is None and bills_pdf is None:
        raise HTTPException(status_code=400, detail="Upload an order CSV, a bill PDF, or both")

    vendor_name: Optional[str] = vendor
    orders: list[dict] = []
    if orders_csv is not None:
        raw = await orders_csv.read()
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = raw.decode("latin-1")
        orders = parse_flipkart_csv(text)
        if not orders:
            raise HTTPException(
                status_code=400,
                detail="No orders found — expected a Flipkart order export with an 'Order Id' column",
            )

    bills: list[dict] = []
    if bills_pdf is not None:
        try:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(await bills_pdf.read()))
            text = "\n".join((p.extract_text() or "") for p in reader.pages)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Could not read the PDF: {exc}")
        bills = parse_vyapar_pdf_text(text)
        vendor_name = vendor or detect_supplier(text)
        if not bills:
            raise HTTPException(
                status_code=400,
                detail="No transactions found — expected a Vyapar party statement PDF",
            )

    # Persist the parsed bills so matches, aliases and applied costs survive the
    # upload. Bills are keyed by ref no, so re-uploading an overlapping
    # statement updates rather than duplicates.
    saved = {}
    if bills:
        vendor_id = await resolve_vendor(db, company.id, vendor_name)
        saved = await save_bills(
            db, company.id, vendor_id, vendor_name, bills,
            bills_pdf.filename if bills_pdf else None,
        )

    result = await db.execute(select(Sku.shringar_sku).where(Sku.company_id == company.id))
    known = [s for (s,) in result.all()]
    report = build_report(orders, bills, known)
    report["saved"] = saved
    # The stored view carries SKU links, recorded cost and the difference.
    report["stored_bills"] = await bills_view(db, company.id, None) if bills else []
    return report


@router.get("/purchase-bills")
async def list_purchase_bills(
    db: AsyncSession = Depends(get_db),
    company=Depends(get_active_company),
    _=Depends(require_any),
):
    """Saved supplier bills with SKU links and bill-rate vs recorded-cost."""
    return await bills_view(db, company.id, None)


@router.post("/purchase-bills/lines/{line_id}/link")
async def link_bill_line(
    line_id: int,
    sku_id: Optional[int] = None,
    pack_multiple: float = 1.0,
    remember: bool = True,
    db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin)),
    _=Depends(require_any),
):
    """Confirm which SKU a bill line is. `remember` teaches it for next time."""
    res = await link_line(db, company.id, line_id, sku_id, pack_multiple, remember)
    if not res.get("ok"):
        raise HTTPException(status_code=400, detail=res.get("error", "Could not link"))
    return res


@router.post('/purchase-bills/auto-match')
async def auto_match_purchase_bills(
    db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin)),
):
    matched = await rematch_bills(db, company.id)
    await db.commit()
    return {'matched': matched}


@router.post("/purchase-bills/lines/{line_id}/apply-cost")
async def apply_bill_cost(
    line_id: int,
    pricing_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin)),
    _=Depends(require_any),
):
    """Set the linked SKU's Product Cost from this line's unit rate."""
    res = await apply_cost(db, company.id, line_id, pricing_id)
    if not res.get("ok"):
        raise HTTPException(status_code=400, detail=res.get("error", "Could not apply cost"))
    return res


@router.get("/", response_model=list[InvoiceResponse])
async def list_invoices(
    db: AsyncSession = Depends(get_db),
    scope=Depends(get_company_scope),
    _=Depends(get_current_user),
    status_filter: Optional[str] = Query(None, alias="status"),
):
    q = (select(Invoice).options(selectinload(Invoice.lines))
         .where(Invoice.company_id.in_(scope.ids))
         .order_by(Invoice.invoice_date.desc(), Invoice.id.desc()))
    invoices = (await db.execute(q)).scalars().all()
    co = await _company_meta(db, scope.ids)
    out = [_to_response(i, co) for i in invoices]
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
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin)),
    user: User = Depends(require_any),
):
    from app.services.tenant_refs import validate_references
    try:
        for line in payload.lines:
            await validate_references(db, company.id, {'sku_id': line.sku_id})
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    if payload.amount_paid:
        raise HTTPException(422, 'Create and issue the invoice, then record a dated receipt')
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
    try:
        recalc_totals(inv)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    db.add(inv)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Invoice number already exists in this company")
    inv = await _get_owned(db, inv.id, company.id)
    return _to_response(inv)


@router.patch("/{invoice_id}", response_model=InvoiceResponse)
async def update_invoice(
    invoice_id: int,
    payload: InvoiceUpdate,
    db: AsyncSession = Depends(get_db),
    scope=Depends(get_company_scope),
    user: User = Depends(require_any),
):
    # The invoice carries its own company, so this is unambiguous in master mode.
    inv = await _get_owned(db, invoice_id, scope.ids)
    await require_role_in_company(db, user, inv.company_id)
    data = payload.model_dump(exclude_unset=True)
    if 'amount_paid' in data and data['amount_paid'] != inv.amount_paid:
        raise HTTPException(409, 'Use the dated receipt workflow to change paid amounts')
    void_only = (set(data) <= {'status', 'notes'} and data.get('status') == 'cancelled'
                 and inv.status == 'sent' and inv.amount_paid == 0)
    payment_only = (set(data) <= {'status', 'amount_paid', 'notes'}
                    and data.get('status', inv.status) in ('sent', 'paid')
                    and data.get('amount_paid', inv.amount_paid) >= inv.amount_paid
                    and inv.status not in ('paid', 'cancelled'))
    if (inv.status != 'draft' or inv.amount_paid > 0) and set(data) - {'notes'} and not payment_only and not void_only:
        raise HTTPException(status_code=409, detail="Issued or paid invoices cannot be rewritten. An unpaid sent invoice can be voided; create a new draft for corrected details.")
    lines = data.pop("lines", None)
    from app.services.tenant_refs import validate_references
    try:
        for line in lines or []:
            await validate_references(db, inv.company_id, {'sku_id': line.get('sku_id')})
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    for k, v in data.items():
        setattr(inv, k, v)
    if lines is not None:
        inv.lines.clear()
        for l in lines:
            inv.lines.append(InvoiceLine(description=l["description"], sku_id=l.get("sku_id"),
                                         quantity=l.get("quantity", 1), unit_price=l.get("unit_price", 0)))
    try:
        recalc_totals(inv)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Invoice number already exists in this company")
    inv = await _get_owned(db, invoice_id, inv.company_id)
    return _to_response(inv)


@router.delete("/{invoice_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_invoice(
    invoice_id: int,
    db: AsyncSession = Depends(get_db),
    scope=Depends(get_company_scope),
    user: User = Depends(require_any),
):
    inv = await _get_owned(db, invoice_id, scope.ids)
    await require_role_in_company(db, user, inv.company_id)
    if inv.status != "draft" or inv.amount_paid > 0:
        raise HTTPException(status_code=409, detail="Only unpaid draft invoices can be deleted")
    await db.delete(inv)
    await db.commit()


from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.models.ledger import PAYMENT_METHODS
from app.models.receipt import InvoiceReceipt

class ReceiptInput(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    amount: float = Field(gt=0)
    receipt_date: date
    payment_method: str
    reference_no: str | None = Field(default=None, max_length=100)
    request_key: str = Field(min_length=8, max_length=80)

    @field_validator('payment_method')
    @classmethod
    def valid_method(cls, value):
        if value not in PAYMENT_METHODS:
            raise ValueError('Choose a supported payment method')
        return value

class ReversalInput(BaseModel):
    reversal_date: date

@router.get('/{invoice_id}/receipts')
async def list_receipts(invoice_id: int, db: AsyncSession = Depends(get_db),
    scope=Depends(get_company_scope), user: User = Depends(require_any)):
    inv = await _get_owned(db, invoice_id, scope.ids)
    rows = (await db.scalars(select(InvoiceReceipt).where(InvoiceReceipt.invoice_id == inv.id,
        InvoiceReceipt.company_id == inv.company_id).order_by(InvoiceReceipt.id))).all()
    return [{'id': r.id, 'amount': r.amount, 'receipt_date': r.receipt_date,
             'payment_method': r.payment_method, 'reversed': r.reversal_entry_id is not None} for r in rows]

@router.post('/{invoice_id}/receipts')
async def post_receipt(invoice_id: int, payload: ReceiptInput, db: AsyncSession = Depends(get_db),
    scope=Depends(get_company_scope), user: User = Depends(require_any)):
    inv = await _get_owned(db, invoice_id, scope.ids)
    await require_role_in_company(db, user, inv.company_id)
    from app.services.receipts import record_receipt
    try:
        receipt = await record_receipt(db, inv.company_id, inv.id, payload, user.id)
        return {'id': receipt.id, 'amount': receipt.amount}
    except (ValueError, IntegrityError) as exc:
        await db.rollback()
        raise HTTPException(409, str(exc) if isinstance(exc, ValueError) else 'Concurrent receipt change; retry with the same request key') from exc

@router.post('/receipts/{receipt_id}/reverse')
async def undo_receipt(receipt_id: int, payload: ReversalInput, db: AsyncSession = Depends(get_db),
    scope=Depends(get_company_scope), user: User = Depends(require_any)):
    receipt = await db.scalar(select(InvoiceReceipt).where(InvoiceReceipt.id == receipt_id,
        InvoiceReceipt.company_id.in_(scope.ids)))
    if receipt is None:
        raise HTTPException(404, 'Receipt not found')
    await require_role_in_company(db, user, receipt.company_id)
    from app.services.receipts import reverse_receipt
    try:
        result = await reverse_receipt(db, receipt.company_id, receipt.id, payload.reversal_date, user.id)
        return {'id': result.id, 'reversed': True}
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(409, str(exc)) from exc


from pydantic import BaseModel, Field
from app.models.purchase import PurchaseBill, PurchaseBillLine


class BillUnitsInput(BaseModel):
    unit: str
    pieces_per_unit: int = Field(ge=1, le=100000)


@router.patch("/purchase-bills/lines/{line_id}/units")
async def update_bill_units(line_id: int, payload: BillUnitsInput,
    db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin))):
    if payload.unit not in {"piece", "box", "set"}:
        raise HTTPException(422, "Choose piece, box or set")
    if payload.unit == "piece" and payload.pieces_per_unit != 1:
        raise HTTPException(422, "A single piece contains exactly one piece")
    line = await db.scalar(select(PurchaseBillLine).join(PurchaseBill).where(
        PurchaseBillLine.id == line_id, PurchaseBill.company_id == company.id))
    if line is None:
        raise HTTPException(404, "Bill line not found")
    from app.models.catalogue import StockCost
    if (line.unit, line.pieces_per_unit) != (payload.unit, payload.pieces_per_unit) and await db.scalar(
        select(StockCost.id).where(StockCost.company_id == company.id,
            StockCost.source_type == "bill_line", StockCost.source_id == line.id)):
        raise HTTPException(409, "This bill cost is approved. Record a documented manual cost correction in the product profile.")
    line.unit = payload.unit
    line.pieces_per_unit = payload.pieces_per_unit
    await db.commit()
    return {"unit": line.unit, "pieces_per_unit": line.pieces_per_unit}


@router.get("/purchase-bills/sku-options")
async def bill_sku_options(db: AsyncSession = Depends(get_db),
    company=Depends(get_active_company), _=Depends(require_any)):
    from app.models.marketplace_alias import MarketplaceSkuAlias
    aliases = (await db.scalars(select(MarketplaceSkuAlias).where(
        MarketplaceSkuAlias.company_id == company.id))).all()
    skus = (await db.scalars(select(Sku).where(Sku.company_id == company.id)
        .order_by(Sku.shringar_sku))).all()
    names = {}
    for alias in aliases:
        names.setdefault(alias.sku_id, []).append(alias.name)
    return [{"id": s.id, "shringar_sku": s.shringar_sku, "vendor_sku": s.vendor_sku,
        "description": s.description, "aliases": names.get(s.id, [])} for s in skus]


class BillRowInput(BaseModel):
    bill_date: date
    ref_no: str = Field(min_length=1, max_length=60)
    item_name: str = Field(min_length=1, max_length=300)
    quantity: float = Field(gt=0, allow_inf_nan=False)
    amount: float = Field(ge=0, allow_inf_nan=False)
    unit: str = "piece"
    pieces_per_unit: int | None = Field(default=None, ge=1, le=100000)


@router.patch("/purchase-bills/lines/{line_id}")
async def edit_bill_row(line_id: int, payload: BillRowInput,
    db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin))):
    bill = await db.scalar(select(PurchaseBill).join(PurchaseBillLine).where(
        PurchaseBillLine.id == line_id, PurchaseBill.company_id == company.id)
        .options(selectinload(PurchaseBill.lines)))
    if bill is None:
        raise HTTPException(404, "Bill line not found")
    ref, name = payload.ref_no.strip(), payload.item_name.strip()
    if not ref or not name:
        raise HTTPException(422, "Reference and item are required")
    duplicate = await db.scalar(select(PurchaseBill.id).where(
        PurchaseBill.company_id == company.id, PurchaseBill.supplier_key == bill.supplier_key,
        PurchaseBill.ref_no == ref, PurchaseBill.id != bill.id))
    if duplicate:
        raise HTTPException(409, "This supplier already has a bill with that reference")
    line = next(l for l in bill.lines if l.id == line_id)
    old_amount = line.amount
    if old_amount is None:
        raise HTTPException(409, "Original line amount is missing; reconcile this bill before editing")
    if payload.unit not in {"piece", "box", "set"}:
        raise HTTPException(422, "Choose piece, box or set")
    units = 1 if payload.unit == "piece" else payload.pieces_per_unit
    if units is None:
        raise HTTPException(422, "Enter units per box or set")
    from app.models.catalogue import StockCost
    approved = await db.scalar(select(StockCost.id).where(StockCost.company_id == company.id,
        StockCost.source_type == "bill_line", StockCost.source_id == line.id))
    if approved and (line.price_unit != round(payload.amount / payload.quantity, 4) or
                     line.unit != payload.unit or line.pieces_per_unit != units):
        raise HTTPException(409, "This bill cost is approved; record a cost correction in the product profile")
    bill.bill_date, bill.ref_no = payload.bill_date, ref
    line.item_name, line.quantity = name, payload.quantity
    line.amount = round(payload.amount, 2)
    line.price_unit = round(line.amount / payload.quantity, 4)
    line.unit, line.pieces_per_unit, line.pack_multiple = payload.unit, units, 1
    from app.core.time import utcnow
    line.edited_at = utcnow()
    bill.total = round(bill.total + line.amount - old_amount, 2)
    bill.lines_total = round(sum(l.amount or 0 for l in bill.lines), 2)
    from app.services.purchase import _post_to_ledger
    await _post_to_ledger(db, bill, [{"name": l.item_name} for l in bill.lines],
        [l.sku_id if l.match_source in ("manual", "alias") else None for l in bill.lines])
    await db.commit()
    return {"id": line.id, "price": line.price_unit, "amount": line.amount, "quantity": line.quantity}
