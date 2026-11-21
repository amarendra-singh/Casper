"""Product profiles, approved costs, media and explicit shared stock operations."""
from datetime import date
from hashlib import sha256
from io import BytesIO
import json
from math import isfinite
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_company_scope, require_any, require_company_role
from app.models.catalogue import SkuImage, StockCost, StockItem, StockMovement
from app.models.company import CompanyRole
from app.models.category import Category
from app.models.purchase import PurchaseBill, PurchaseBillLine
from app.models.sku import Sku, SkuPricing
from app.models.platform import Platform
from app.models.vendor import Vendor
from app.services.catalogue import catalogue_page, product_profile, stock_balance
from app.services.pnl_statement import recover_unpriced_reports
from app.services.pricing import money_round, recalculate_pricing, set_reverse_shipping_override
from app.services.catalogue_import import CatalogueActions, apply_catalogue_actions

router = APIRouter(prefix="/catalogue", tags=["Catalogue"])


class ProfileInput(BaseModel):
    display_name: str | None = Field(default=None, max_length=200)
    description: str | None = None
    vendor_sku: str | None = Field(default=None, max_length=150)
    is_active: bool | None = None
    gst_rate: float | None = Field(default=None, ge=0, le=100)

    @field_validator("gst_rate")
    @classmethod
    def finite_gst(cls, value):
        if value is not None and not isfinite(value):
            raise ValueError("GST must be finite")
        return value


class ReverseShippingInput(BaseModel):
    platform_id: int
    charge: float | None = Field(default=None, ge=0)

    @field_validator("charge")
    @classmethod
    def finite_charge(cls, value):
        if value is not None and not isfinite(value):
            raise ValueError("Charge must be finite")
        return value


class BulkProductRow(BaseModel):
    shringar_sku: str = Field(min_length=1, max_length=150)
    display_name: str | None = Field(default=None, max_length=200)
    vendor_sku: str | None = Field(default=None, max_length=150)
    vendor: str | None = Field(default=None, max_length=150)
    category: str | None = Field(default=None, max_length=100)
    description: str | None = None

    @field_validator("shringar_sku")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        return value.strip().upper()


class BulkProductInput(BaseModel):
    rows: list[BulkProductRow] = Field(min_length=1, max_length=500)


class StockItemInput(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    base_unit: str = Field(default="piece", min_length=1, max_length=30)


class StockLinkInput(BaseModel):
    stock_item_id: int
    base_units_per_sku: int = Field(ge=1, le=100000)


class MovementInput(BaseModel):
    movement_type: str
    sku_quantity: int = Field(ge=-1000000, le=1000000)
    movement_date: date
    request_key: str = Field(min_length=8, max_length=80)
    reason: str | None = Field(default=None, max_length=500)
    inspected_resaleable: bool = False
    bill_line_id: int | None = None


class ReversalInput(BaseModel):
    movement_date: date
    reason: str = Field(min_length=3, max_length=500)


class CostInput(BaseModel):
    source_type: str = "manual"
    source_id: int | None = None
    cost_per_base_unit: float | None = None
    effective_date: date
    note: str | None = Field(default=None, max_length=300)


class ApplyCostInput(BaseModel):
    token: str = Field(min_length=64, max_length=64)


def _media_dir() -> Path:
    return Path(settings.PRODUCT_MEDIA_DIR).expanduser().resolve()


async def _sku(db, company_id, sku_id):
    sku = await db.scalar(select(Sku).where(Sku.id == sku_id, Sku.company_id == company_id))
    if sku is None:
        raise HTTPException(404, "Product not found")
    return sku


async def _item(db, company_id, item_id):
    item = await db.scalar(select(StockItem).where(StockItem.id == item_id,
        StockItem.company_id == company_id))
    if item is None:
        raise HTTPException(404, "Stock item not found")
    return item


@router.get("")
async def list_catalogue(db: AsyncSession = Depends(get_db), scope=Depends(get_company_scope),
    _=Depends(require_any), q: str | None = Query(None, max_length=150),
    platform_id: int | None = None, vendor_id: int | None = None,
    category_id: int | None = None, active: bool | None = None,
    page: int = Query(1, ge=1), page_size: int = Query(40, ge=1, le=100)):
    if platform_id is not None:
        from app.models.platform import Platform
        if not await db.scalar(select(Platform.id).where(Platform.id == platform_id,
            Platform.company_id.in_(scope.ids))):
            raise HTTPException(404, "Platform not found")
    return await catalogue_page(db, scope.ids, q=q, platform_id=platform_id,
        vendor_id=vendor_id, category_id=category_id, active=active,
        page=page, page_size=page_size)


@router.get("/stock-items")
async def list_stock_items(db: AsyncSession = Depends(get_db), scope=Depends(get_company_scope),
    _=Depends(require_any)):
    items = (await db.scalars(select(StockItem).where(StockItem.company_id.in_(scope.ids))
        .order_by(StockItem.name))).all()
    return [{"id": i.id, "company_id": i.company_id, "name": i.name,
        "base_unit": i.base_unit} for i in items]


@router.post("/bulk-products", status_code=201)
async def bulk_create_products(payload: BulkProductInput, db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin))):
    """Create product identities as one batch; pricing, costs and stock are separate."""
    rows = payload.rows
    codes = [row.shringar_sku for row in rows]
    if any(not code for code in codes) or len(codes) != len(set(codes)):
        raise HTTPException(422, "Each row needs a unique SKU code")
    existing = (await db.scalars(select(Sku.shringar_sku).where(
        Sku.company_id == company.id, func.upper(Sku.shringar_sku).in_(codes)))).all()
    if existing:
        raise HTTPException(409, f"SKU already exists: {', '.join(sorted(existing)[:5])}")
    vendors = {vendor.name.strip().casefold(): vendor.id for vendor in
        (await db.scalars(select(Vendor).where(Vendor.company_id == company.id))).all()}
    categories = {category.name.strip().casefold(): category.id for category in
        (await db.scalars(select(Category).where(Category.company_id == company.id))).all()}
    products = []
    for number, row in enumerate(rows, 1):
        vendor_name = (row.vendor or "").strip()
        category_name = (row.category or "").strip()
        if vendor_name and vendor_name.casefold() not in vendors:
            raise HTTPException(422, f"Row {number}: vendor '{vendor_name}' does not exist in this company")
        if category_name and category_name.casefold() not in categories:
            raise HTTPException(422, f"Row {number}: category '{category_name}' does not exist in this company")
        products.append(Sku(company_id=company.id, shringar_sku=row.shringar_sku,
            display_name=(row.display_name or "").strip() or None,
            vendor_sku=(row.vendor_sku or "").strip() or None,
            vendor_id=vendors.get(vendor_name.casefold()) if vendor_name else None,
            category_id=categories.get(category_name.casefold()) if category_name else None,
            description=(row.description or "").strip() or None))
    db.add_all(products)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "A SKU was created concurrently; reload and review the file")
    return {"created": len(products), "ids": [product.id for product in products]}


@router.post("/bulk-apply")
async def bulk_apply_products(payload: str = Form(...), files: list[UploadFile] = File(default=[]),
    db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin)),
    user=Depends(require_any)):
    try:
        parsed = CatalogueActions.model_validate_json(payload)
    except ValueError as exc:
        raise HTTPException(422, f"Invalid catalogue sheet: {exc}") from exc
    try:
        return await apply_catalogue_actions(db, company.id, user.id, parsed, files, _media_dir())
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "Catalogue changed during import; reload and review the sheet") from exc


@router.post("/stock-items", status_code=201)
async def create_stock_item(payload: StockItemInput, db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin))):
    name = payload.name.strip()
    if await db.scalar(select(StockItem.id).where(StockItem.company_id == company.id,
        func.lower(StockItem.name) == name.lower())):
        raise HTTPException(409, "Stock item name already exists")
    item = StockItem(company_id=company.id, name=name, base_unit=payload.base_unit.strip())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return {"id": item.id, "name": item.name, "base_unit": item.base_unit}


@router.get("/images/{image_id}")
async def get_image(image_id: int, thumb: bool = False, db: AsyncSession = Depends(get_db),
    scope=Depends(get_company_scope), _=Depends(require_any)):
    image = await db.scalar(select(SkuImage).where(SkuImage.id == image_id,
        SkuImage.company_id.in_(scope.ids)))
    if image is None:
        raise HTTPException(404, "Image not found")
    name = image.file_name.replace(".webp", "_thumb.webp") if thumb else image.file_name
    file_path = _media_dir() / name
    if not file_path.is_file():
        raise HTTPException(404, "Image file unavailable")
    return FileResponse(file_path, media_type="image/webp", headers={"Cache-Control": "private, max-age=300"})


@router.get("/{sku_id}")
async def get_product(sku_id: int, db: AsyncSession = Depends(get_db),
    scope=Depends(get_company_scope), _=Depends(require_any),
    platform_id: int | None = None, start: date | None = None, end: date | None = None):
    if start and end and start > end:
        raise HTTPException(422, "Start date must precede end date")
    if platform_id is not None:
        from app.models.platform import Platform
        if not await db.scalar(select(Platform.id).where(
            Platform.id == platform_id, Platform.company_id.in_(scope.ids))):
            raise HTTPException(404, "Platform not found")
    result = await product_profile(db, scope.ids, sku_id,
        platform_id=platform_id, start=start, end=end)
    if result is None:
        raise HTTPException(404, "Product not found")
    return result


@router.patch("/{sku_id}")
async def update_profile(sku_id: int, payload: ProfileInput, db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin))):
    sku = await _sku(db, company.id, sku_id)
    updates = payload.model_dump(exclude_unset=True)
    if "display_name" in updates:
        sku.display_name = (updates["display_name"] or "").strip() or None
    if "description" in updates:
        sku.description = updates["description"]
    if "vendor_sku" in updates:
        sku.vendor_sku = (updates["vendor_sku"] or "").strip() or None
    if "is_active" in updates:
        sku.is_active = updates["is_active"]
    if "gst_rate" in updates:
        from app.services.sku_tax import set_catalogue_gst
        await set_catalogue_gst(db, sku, updates["gst_rate"])
    await db.commit()
    return {"id": sku.id, "display_name": sku.display_name,
        "description": sku.description, "vendor_sku": sku.vendor_sku,
        "is_active": sku.is_active, "gst_rate": sku.gst_rate}


@router.put("/{sku_id}/reverse-shipping")
async def update_reverse_shipping(sku_id: int, payload: ReverseShippingInput,
    db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin))):
    sku = await _sku(db, company.id, sku_id)
    platform = await db.scalar(select(Platform).where(
        Platform.id == payload.platform_id, Platform.company_id == company.id))
    if platform is None:
        raise HTTPException(404, "Platform not found in this company")
    await set_reverse_shipping_override(db, sku.id, platform.id, company.id, payload.charge)
    for pricing in (await db.scalars(select(SkuPricing).where(
        SkuPricing.company_id == company.id, SkuPricing.sku_id == sku.id,
        SkuPricing.platform_id == platform.id))).all():
        await recalculate_pricing(db, pricing)
    await db.commit()
    return {"sku_id": sku.id, "platform_id": platform.id,
            "charge": payload.charge, "effective_charge": platform.cr_charge if payload.charge is None else payload.charge}


@router.post("/{sku_id}/stock-link")
async def link_stock(sku_id: int, payload: StockLinkInput, db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin))):
    sku = await _sku(db, company.id, sku_id)
    item = await _item(db, company.id, payload.stock_item_id)
    if sku.stock_item_id and sku.stock_item_id != item.id:
        if await db.scalar(select(StockMovement.id).where(StockMovement.company_id == company.id,
            StockMovement.sku_id == sku.id).limit(1)):
            raise HTTPException(409, "Reverse this SKU's stock movements before changing its physical item")
    if sku.base_units_per_sku and sku.base_units_per_sku != payload.base_units_per_sku:
        if await db.scalar(select(StockMovement.id).where(StockMovement.company_id == company.id,
            StockMovement.sku_id == sku.id).limit(1)):
            raise HTTPException(409, "Reverse this SKU's stock movements before changing its pack conversion")
    sku.stock_item_id = item.id
    sku.base_units_per_sku = payload.base_units_per_sku
    await db.commit()
    return {"sku_id": sku.id, "stock_item_id": item.id,
        "base_units_per_sku": sku.base_units_per_sku}


@router.post("/{sku_id}/movements", status_code=201)
async def record_movement(sku_id: int, payload: MovementInput, db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin)),
    user=Depends(require_any)):
    sku = await _sku(db, company.id, sku_id)
    if not sku.stock_item_id or not sku.base_units_per_sku:
        raise HTTPException(409, "Link this SKU to a physical stock item and confirm pack units first")
    allowed = {"opening", "receipt", "dispatch", "return", "damage", "adjustment"}
    if payload.movement_type not in allowed:
        raise HTTPException(422, "Invalid movement type")
    if payload.sku_quantity == 0:
        raise HTTPException(422, "Quantity must not be zero")
    if payload.movement_type != "adjustment" and payload.sku_quantity < 0:
        raise HTTPException(422, "Use a positive quantity for this movement type")
    if payload.movement_type == "return" and not payload.inspected_resaleable:
        raise HTTPException(422, "Inspect and confirm the return is resaleable before restocking")
    if payload.movement_type == "adjustment" and not (payload.reason or "").strip():
        raise HTTPException(422, "Give a reason for stock adjustment")
    sign = -1 if payload.movement_type in {"dispatch", "damage"} else 1
    delta = sign * payload.sku_quantity * sku.base_units_per_sku
    existing = await db.scalar(select(StockMovement).where(
        StockMovement.company_id == company.id, StockMovement.request_key == payload.request_key))
    if existing:
        if (existing.sku_id, existing.movement_type, existing.base_units_delta,
            existing.movement_date, existing.reason, existing.reference_id) != (
                sku.id, payload.movement_type, delta, payload.movement_date,
                payload.reason, payload.bill_line_id):
            raise HTTPException(409, "Request key already belongs to a different stock movement")
        return {"id": existing.id, "base_units_delta": existing.base_units_delta, "replayed": True}
    # SQLite ignores SELECT FOR UPDATE. Acquire its write lock before reading
    # the aggregate, so two dispatches cannot both spend the same units.
    await db.execute(update(StockItem).where(StockItem.id == sku.stock_item_id,
        StockItem.company_id == company.id).values(name=StockItem.name))
    existing = await db.scalar(select(StockMovement).where(
        StockMovement.company_id == company.id, StockMovement.request_key == payload.request_key))
    if existing:
        if (existing.sku_id, existing.movement_type, existing.base_units_delta,
            existing.movement_date, existing.reason, existing.reference_id) != (
                sku.id, payload.movement_type, delta, payload.movement_date,
                payload.reason, payload.bill_line_id):
            raise HTTPException(409, "Request key already belongs to a different stock movement")
        return {"id": existing.id, "base_units_delta": existing.base_units_delta, "replayed": True}
    await db.scalar(select(StockItem.id).where(StockItem.id == sku.stock_item_id,
        StockItem.company_id == company.id).with_for_update())
    balance = await stock_balance(db, company.id, sku.stock_item_id)
    if payload.movement_type == "opening" and balance is not None:
        raise HTTPException(409, "Opening balance already recorded; use an adjustment")
    if balance is None and delta < 0:
        raise HTTPException(409, "Record opening stock or a goods receipt first")
    if balance is not None and balance + delta < 0:
        raise HTTPException(409, "Insufficient on-hand stock")
    reference_type = None
    if payload.bill_line_id:
        if payload.movement_type != "receipt":
            raise HTTPException(422, "Supplier bill link is valid only for a goods receipt")
        line = await db.scalar(select(PurchaseBillLine).join(PurchaseBill,
            PurchaseBill.id == PurchaseBillLine.bill_id).where(PurchaseBillLine.id == payload.bill_line_id,
            PurchaseBill.company_id == company.id, PurchaseBillLine.sku_id == sku.id,
            PurchaseBillLine.match_source.in_(["manual", "alias"])))
        if line is None:
            raise HTTPException(404, "Confirmed supplier bill line not found for this SKU")
        reference_type = "bill_line"
    movement = StockMovement(company_id=company.id, stock_item_id=sku.stock_item_id,
        sku_id=sku.id, movement_date=payload.movement_date,
        movement_type=payload.movement_type, base_units_delta=delta,
        request_key=payload.request_key, reference_type=reference_type,
        reference_id=payload.bill_line_id, reason=payload.reason, created_by=user.id)
    db.add(movement)
    await db.commit()
    await db.refresh(movement)
    return {"id": movement.id, "base_units_delta": delta,
        "on_hand_base_units": (balance or 0) + delta, "replayed": False}


@router.post("/movements/{movement_id}/reverse")
async def reverse_movement(movement_id: int, payload: ReversalInput,
    db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin)),
    user=Depends(require_any)):
    source = await db.scalar(select(StockMovement).where(StockMovement.id == movement_id,
        StockMovement.company_id == company.id))
    if source is None:
        raise HTTPException(404, "Stock movement not found")
    if source.reverses_id:
        raise HTTPException(409, "A reversal cannot be reversed directly")
    existing = await db.scalar(select(StockMovement).where(StockMovement.company_id == company.id,
        StockMovement.reverses_id == source.id))
    if existing:
        return {"id": existing.id, "base_units_delta": existing.base_units_delta, "replayed": True}
    await db.execute(update(StockItem).where(StockItem.id == source.stock_item_id,
        StockItem.company_id == company.id).values(name=StockItem.name))
    existing = await db.scalar(select(StockMovement).where(StockMovement.company_id == company.id,
        StockMovement.reverses_id == source.id))
    if existing:
        return {"id": existing.id, "base_units_delta": existing.base_units_delta, "replayed": True}
    balance = await stock_balance(db, company.id, source.stock_item_id)
    if balance is None or balance - source.base_units_delta < 0:
        raise HTTPException(409, "Cannot reverse: stock already used; record a documented adjustment")
    reversal = StockMovement(company_id=company.id, stock_item_id=source.stock_item_id,
        sku_id=source.sku_id, movement_date=payload.movement_date,
        movement_type="reversal", base_units_delta=-source.base_units_delta,
        request_key=f"reverse:{source.id}", reverses_id=source.id,
        reason=payload.reason, created_by=user.id)
    db.add(reversal)
    await db.commit()
    await db.refresh(reversal)
    return {"id": reversal.id, "base_units_delta": reversal.base_units_delta,
        "on_hand_base_units": balance - source.base_units_delta, "replayed": False}


@router.post("/stock-items/{item_id}/costs", status_code=201)
async def approve_cost(item_id: int, payload: CostInput, db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin)),
    user=Depends(require_any)):
    await _item(db, company.id, item_id)
    if payload.source_type not in {"manual", "bill_line"}:
        raise HTTPException(422, "Invalid cost source")
    if payload.source_type == "bill_line":
        if payload.source_id is None:
            raise HTTPException(422, "Choose a confirmed bill line")
        line = await db.scalar(select(PurchaseBillLine).join(PurchaseBill,
            PurchaseBill.id == PurchaseBillLine.bill_id).where(PurchaseBillLine.id == payload.source_id,
            PurchaseBill.company_id == company.id,
            PurchaseBillLine.match_source.in_(["manual", "alias"])))
        if line is None or line.sku_id is None or line.unit_cost is None:
            raise HTTPException(404, "Confirmed costed bill line not found")
        sku = await _sku(db, company.id, line.sku_id)
        if sku.stock_item_id != item_id or not sku.base_units_per_sku:
            raise HTTPException(409, "Bill SKU must use this stock item with an explicit conversion")
        if line.unit != "item" and (not line.pieces_per_unit or line.unit not in {"piece", "box", "set"}):
            raise HTTPException(409, "Save the supplier unit and pieces per unit before approving this bill cost")
        # Keep four decimals in the shared base-unit rate; a two-decimal
        # intermediate (bill unit cost) can drift when converted back to P6.
        calculated = round(line.price_unit / (sku.base_units_per_sku if line.unit == "item" else line.pieces_per_unit), 4)
        if payload.cost_per_base_unit is not None and abs(payload.cost_per_base_unit - calculated) > 0.0001:
            raise HTTPException(409, "Cost does not match confirmed bill rate and pack conversion")
        cost_value = calculated
        existing = await db.scalar(select(StockCost).where(StockCost.company_id == company.id,
            StockCost.source_type == "bill_line", StockCost.source_id == line.id))
        if existing:
            if existing.stock_item_id != item_id or existing.cost_per_base_unit != calculated:
                raise HTTPException(409, "This bill line was already approved with a different cost")
            return {"id": existing.id, "cost_per_base_unit": existing.cost_per_base_unit,
                "replayed": True}
    else:
        if payload.source_id is not None or payload.cost_per_base_unit is None:
            raise HTTPException(422, "Manual cost requires an amount and no bill line")
        if not (payload.note or "").strip():
            raise HTTPException(422, "Explain the manual cost source")
        cost_value = payload.cost_per_base_unit
    if not isfinite(cost_value) or round(cost_value, 4) <= 0:
        raise HTTPException(422, "Cost must be positive and finite")
    cost = StockCost(company_id=company.id, stock_item_id=item_id,
        cost_per_base_unit=round(cost_value, 4), source_type=payload.source_type,
        source_id=payload.source_id, effective_date=payload.effective_date,
        note=payload.note, approved_by=user.id)
    db.add(cost)
    await db.commit()
    await db.refresh(cost)
    return {"id": cost.id, "cost_per_base_unit": cost.cost_per_base_unit, "replayed": False}


async def _cost_plan(db, company_id, item_id):
    cost = await db.scalar(select(StockCost).where(StockCost.company_id == company_id,
        StockCost.stock_item_id == item_id, StockCost.effective_date <= date.today())
        .order_by(StockCost.effective_date.desc(), StockCost.id.desc()).limit(1))
    if cost is None:
        raise HTTPException(409, "Approve a current stock cost first")
    rows = (await db.execute(select(SkuPricing, Sku).join(Sku, Sku.id == SkuPricing.sku_id)
        .where(SkuPricing.company_id == company_id, Sku.company_id == company_id,
            Sku.stock_item_id == item_id).order_by(SkuPricing.id))).all()
    updates = [{"pricing_id": p.id, "sku_id": sku.id, "our_sku": sku.shringar_sku,
        "platform_id": p.platform_id, "before": p.price,
        "after": money_round(cost.cost_per_base_unit * sku.base_units_per_sku)}
        for p, sku in rows if sku.base_units_per_sku and
        abs(p.price - money_round(cost.cost_per_base_unit * sku.base_units_per_sku)) > 0.001]
    fingerprint = sha256(json.dumps({"cost_id": cost.id, "updates": updates},
        sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return cost, updates, fingerprint


@router.get("/stock-items/{item_id}/cost-preview")
async def preview_cost(item_id: int, db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin))):
    await _item(db, company.id, item_id)
    cost, updates, token = await _cost_plan(db, company.id, item_id)
    return {"cost_id": cost.id, "cost_per_base_unit": cost.cost_per_base_unit,
        "updates": updates, "token": token}


@router.post("/stock-items/{item_id}/cost-apply")
async def apply_cost(item_id: int, payload: ApplyCostInput, db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin))):
    await _item(db, company.id, item_id)
    _cost, updates, token = await _cost_plan(db, company.id, item_id)
    if token != payload.token:
        raise HTTPException(409, "Cost or pricing changed; preview again")
    with db.no_autoflush:
        for update in updates:
            pricing = await db.scalar(select(SkuPricing).where(SkuPricing.id == update["pricing_id"],
                SkuPricing.company_id == company.id))
            pricing.price = update["after"]
            await recalculate_pricing(db, pricing)
    if updates:
        await recover_unpriced_reports(db, company.id)
        await db.commit()
    return {"updated": len(updates)}


@router.post("/{sku_id}/images", status_code=201)
async def upload_image(sku_id: int, file: UploadFile = File(...),
    alt_text: str = Form(""), primary: bool = Form(False),
    db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin)),
    user=Depends(require_any)):
    await _sku(db, company.id, sku_id)
    if len(alt_text) > 200:
        raise HTTPException(422, "Alt text is too long")
    raw = await file.read(5 * 1024 * 1024 + 1)
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(413, "Image exceeds 5 MB")
    from PIL import Image, ImageOps, UnidentifiedImageError
    try:
        with Image.open(BytesIO(raw)) as opened:
            if opened.format not in {"JPEG", "PNG", "WEBP"}:
                raise ValueError("Use JPEG, PNG or WebP")
            if opened.width * opened.height > 20_000_000:
                raise ValueError("Image dimensions are too large")
            image_data = ImageOps.exif_transpose(opened).convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise HTTPException(422, str(exc)) from exc
    folder = _media_dir()
    folder.mkdir(parents=True, exist_ok=True)
    stem = uuid4().hex
    full_path, thumb_path = folder / f"{stem}.webp", folder / f"{stem}_thumb.webp"
    try:
        image_data.thumbnail((1600, 1600))
        image_data.save(full_path, format="WEBP", quality=86)
        thumb = image_data.copy()
        thumb.thumbnail((320, 320))
        thumb.save(thumb_path, format="WEBP", quality=78)
        has_primary = await db.scalar(select(SkuImage.id).where(SkuImage.company_id == company.id,
            SkuImage.sku_id == sku_id, SkuImage.is_primary.is_(True)))
        if primary or has_primary is None:
            for old in (await db.scalars(select(SkuImage).where(SkuImage.company_id == company.id,
                SkuImage.sku_id == sku_id, SkuImage.is_primary.is_(True)))).all():
                old.is_primary = False
            await db.flush()
        image = SkuImage(company_id=company.id, sku_id=sku_id,
            file_name=full_path.name, mime_type="image/webp",
            is_primary=primary or has_primary is None,
            alt_text=alt_text.strip() or None, uploaded_by=user.id)
        db.add(image)
        await db.commit()
        await db.refresh(image)
        return {"id": image.id, "is_primary": image.is_primary}
    except Exception:
        await db.rollback()
        full_path.unlink(missing_ok=True)
        thumb_path.unlink(missing_ok=True)
        raise


@router.post("/images/{image_id}/primary")
async def set_primary_image(image_id: int, db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin))):
    image = await db.scalar(select(SkuImage).where(SkuImage.id == image_id,
        SkuImage.company_id == company.id))
    if image is None:
        raise HTTPException(404, "Image not found")
    for old in (await db.scalars(select(SkuImage).where(SkuImage.company_id == company.id,
        SkuImage.sku_id == image.sku_id, SkuImage.is_primary.is_(True)))).all():
        old.is_primary = False
    await db.flush()
    image.is_primary = True
    await db.commit()
    return {"id": image.id, "is_primary": True}


@router.delete("/images/{image_id}", status_code=204)
async def delete_image(image_id: int, db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin))):
    image = await db.scalar(select(SkuImage).where(SkuImage.id == image_id,
        SkuImage.company_id == company.id))
    if image is None:
        raise HTTPException(404, "Image not found")
    name, sku_id, primary = image.file_name, image.sku_id, image.is_primary
    await db.delete(image)
    await db.flush()
    if primary:
        replacement = await db.scalar(select(SkuImage).where(SkuImage.company_id == company.id,
            SkuImage.sku_id == sku_id).order_by(SkuImage.id).limit(1))
        if replacement:
            replacement.is_primary = True
    await db.commit()
    ( _media_dir() / name ).unlink(missing_ok=True)
    ( _media_dir() / name.replace(".webp", "_thumb.webp") ).unlink(missing_ok=True)
