"""Atomic spreadsheet actions for catalogue identity, economics, stock and images."""
from datetime import date
from io import BytesIO
from math import isfinite
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from app.models.catalogue import SkuImage, StockCost, StockItem, StockMovement
from app.models.category import Category
from app.models.hsn_code import HsnCode
from app.models.platform import Platform
from app.models.sku import Sku, SkuPricing
from app.models.vendor import Vendor
from app.services.catalogue import stock_balance
from app.services.pricing import calculate_pricing, recalculate_pricing, resolve_pricing_inputs
from app.services.pnl_statement import recover_unpriced_reports

PRICING_FIELDS = ("price", "package", "logistics", "addons", "profit_percentage",
                  "misc_total", "cr_percentage", "cr_cost", "damage_percentage", "damage_cost",
                  "reverse_shipping_charge")
IDENTITY_FIELDS = ("display_name", "vendor_sku", "vendor", "category", "hsn_code", "gst",
                   "description", "series", "is_active", "stock_item", "base_units_per_sku",
                   "on_hand_base_units", "stock_date", "stock_reason", "cost_per_base_unit",
                   "cost_effective_date", "cost_note", "image_url", "image_file")


class CatalogueAction(BaseModel):
    operation: str
    shringar_sku: str = Field(min_length=1, max_length=150)
    display_name: str | None = Field(default=None, max_length=200)
    vendor_sku: str | None = Field(default=None, max_length=150)
    vendor: str | None = Field(default=None, max_length=150)
    category: str | None = Field(default=None, max_length=100)
    hsn_code: str | None = Field(default=None, max_length=20)
    description: str | None = None
    series: str | None = Field(default=None, max_length=150)
    is_active: bool | None = None
    stock_item: str | None = Field(default=None, max_length=200)
    base_units_per_sku: int | None = Field(default=None, ge=1, le=100000)
    on_hand_base_units: int | None = Field(default=None, ge=0)
    stock_date: date | None = None
    stock_reason: str | None = Field(default=None, max_length=500)
    cost_per_base_unit: float | None = Field(default=None, gt=0)
    cost_effective_date: date | None = None
    cost_note: str | None = Field(default=None, max_length=300)
    platform: str | None = Field(default=None, max_length=100)
    price: float | None = Field(default=None, ge=0)
    package: float | None = Field(default=None, ge=0)
    logistics: float | None = Field(default=None, ge=0)
    addons: float | None = Field(default=None, ge=0)
    gst: float | None = Field(default=None, ge=0, le=100)
    profit_percentage: float | None = Field(default=None, ge=0)
    misc_total: float | None = Field(default=None, ge=0)
    cr_percentage: float | None = Field(default=None, ge=0)
    cr_cost: float | None = Field(default=None, ge=0)
    reverse_shipping_charge: float | None = Field(default=None, ge=0)
    damage_percentage: float | None = Field(default=None, ge=0)
    damage_cost: float | None = Field(default=None, ge=0)
    image_url: str | None = Field(default=None, max_length=2048)
    image_file: str | None = Field(default=None, max_length=255)

    @field_validator("shringar_sku", mode="before")
    @classmethod
    def code(cls, value):
        return value.strip().upper() if isinstance(value, str) else value

    @field_validator("operation", mode="before")
    @classmethod
    def action(cls, value):
        value = value.strip().lower() if isinstance(value, str) else value
        if value not in {"create", "update", "delete"}:
            raise ValueError("Operation must be create, update or delete")
        return value

    @field_validator(*PRICING_FIELDS, "cost_per_base_unit")
    @classmethod
    def finite_number(cls, value):
        if value is not None and not isfinite(value):
            raise ValueError("Amounts must be finite")
        return value


class CatalogueActions(BaseModel):
    rows: list[CatalogueAction] = Field(min_length=1, max_length=500)


def _image_url(value):
    url = (value or "").strip()
    if not url:
        return None
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise HTTPException(422, "Image URL must be a public HTTPS URL without credentials")
    return url


async def _images(files: list[UploadFile], rows: list[CatalogueAction]):
    requested = {row.image_file for row in rows if row.operation != "delete" and row.image_file}
    if len(files) > len(requested):
        raise HTTPException(422, "Upload only the image files named in the sheet")
    received = {}
    total_bytes = 0
    for file in files:
        name = file.filename or ""
        if not name or name in received:
            raise HTTPException(422, "Each uploaded image file needs a unique filename")
        if name not in requested:
            raise HTTPException(422, f"Image file '{name}' is not referenced in the sheet")
        raw = await file.read(5 * 1024 * 1024 + 1)
        total_bytes += len(raw)
        if len(raw) > 5 * 1024 * 1024:
            raise HTTPException(413, f"Image '{name}' exceeds 5 MB")
        if total_bytes > 100 * 1024 * 1024:
            raise HTTPException(413, "Image files exceed the 100 MB batch limit")
        try:
            with Image.open(BytesIO(raw)) as opened:
                if opened.format not in {"JPEG", "PNG", "WEBP"} or opened.width * opened.height > 20_000_000:
                    raise ValueError("Use a JPEG, PNG or WebP under 20 million pixels")
                converted = ImageOps.exif_transpose(opened).convert("RGB")
                converted.thumbnail((1600, 1600))
                full = BytesIO(); converted.save(full, format="WEBP", quality=86)
                converted.thumbnail((320, 320))
                thumb = BytesIO(); converted.save(thumb, format="WEBP", quality=78)
                received[name] = (full.getvalue(), thumb.getvalue())
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
            raise HTTPException(422, f"Image '{name}': {exc}") from exc
    missing = requested - received.keys()
    if missing:
        raise HTTPException(422, f"Missing image file: {sorted(missing)[0]}")
    return received


async def apply_catalogue_actions(db, company_id: int, user_id: int,
                                  payload: CatalogueActions, files: list[UploadFile], media_dir: Path):
    rows = payload.rows
    codes = [row.shringar_sku for row in rows]
    if any(not code for code in codes):
        raise HTTPException(422, "Each row needs a SKU code")
    seen = {}
    for number, row in enumerate(rows, 1):
        key = row.shringar_sku
        platform = (row.platform or "").strip().casefold()
        if key in seen:
            if (row.operation != "update" or not platform or platform in seen[key]
                    or any(getattr(row, field) is not None for field in IDENTITY_FIELDS)
                    or not any(getattr(row, field) is not None for field in PRICING_FIELDS)):
                raise HTTPException(422, f"Row {number}: repeated SKU must update a different platform's economics only")
            seen[key].add(platform)
        else:
            seen[key] = {platform} if platform else set()
    images = await _images(files, rows)
    vendors = {v.name.strip().casefold(): v.id for v in
               (await db.scalars(select(Vendor).where(Vendor.company_id == company_id))).all()}
    categories = {c.name.strip().casefold(): c.id for c in
                  (await db.scalars(select(Category).where(Category.company_id == company_id))).all()}
    hsn_codes = {h.code.strip().upper(): h.id for h in
                 (await db.scalars(select(HsnCode))).all()}
    platforms = {p.name.strip().casefold(): p.id for p in
                 (await db.scalars(select(Platform).where(Platform.company_id == company_id))).all()}
    existing_skus = {s.shringar_sku.upper(): s for s in
                     (await db.scalars(select(Sku).where(Sku.company_id == company_id,
                         func.upper(Sku.shringar_sku).in_(codes)))).all()}
    stock_names = {s.name.strip().casefold(): s for s in
                   (await db.scalars(select(StockItem).where(StockItem.company_id == company_id))).all()}
    written_files = []
    stock_targets = {}
    cost_targets = {}
    counts = {"created": 0, "updated": 0, "deactivated": 0, "images": 0,
              "prices": 0, "costs": 0, "stock": 0}
    try:
        for number, row in enumerate(rows, 1):
            sku = existing_skus.get(row.shringar_sku)
            if row.operation == "create" and sku:
                raise HTTPException(409, f"Row {number}: SKU already exists: {row.shringar_sku}")
            if row.operation != "create" and not sku:
                raise HTTPException(404, f"Row {number}: SKU does not exist: {row.shringar_sku}")
            if row.operation == "delete":
                sku.is_active = False
                counts["deactivated"] += 1
                continue
            if row.operation == "create":
                sku = Sku(company_id=company_id, shringar_sku=row.shringar_sku)
                db.add(sku)
                counts["created"] += 1
            else:
                counts["updated"] += 1
            for field in ("display_name", "vendor_sku", "description", "series", "is_active"):
                value = getattr(row, field)
                if value is not None:
                    if isinstance(value, str):
                        value = value.strip()
                        value = None if not value or value.casefold() == "<clear>" else value
                    setattr(sku, field, value)
            for field, lookup in (("vendor", vendors), ("category", categories)):
                value = (getattr(row, field) or "").strip()
                if value.casefold() == "<clear>":
                    setattr(sku, f"{field}_id", None)
                    continue
                if value:
                    if value.casefold() not in lookup:
                        raise HTTPException(422, f"Row {number}: {field} '{value}' does not exist in this company")
                    setattr(sku, f"{field}_id", lookup[value.casefold()])
            if row.hsn_code:
                code = row.hsn_code.strip().upper()
                if code == "<CLEAR>":
                    sku.hsn_code_id = None
                elif code not in hsn_codes:
                    raise HTTPException(422, f"Row {number}: HSN code '{code}' does not exist")
                else:
                    sku.hsn_code_id = hsn_codes[code]
            if row.image_url is not None:
                sku.primary_image_url = None if row.image_url.strip().casefold() == "<clear>" else _image_url(row.image_url)
            await db.flush()
            existing_skus[row.shringar_sku] = sku
            if row.gst is not None:
                from app.services.sku_tax import set_catalogue_gst
                await set_catalogue_gst(db, sku, row.gst)
            item = None
            if row.stock_item:
                key = row.stock_item.strip().casefold()
                item = stock_names.get(key)
                if not item:
                    item = StockItem(company_id=company_id, name=row.stock_item.strip(), base_unit="piece")
                    db.add(item); await db.flush(); stock_names[key] = item
                if sku.stock_item_id and sku.stock_item_id != item.id:
                    movement = await db.scalar(select(StockMovement.id).where(
                        StockMovement.company_id == company_id, StockMovement.sku_id == sku.id).limit(1))
                    if movement:
                        raise HTTPException(409, f"Row {number}: reverse SKU stock movements before changing its stock item")
                sku.stock_item_id = item.id
            elif sku.stock_item_id:
                item = await db.scalar(select(StockItem).where(StockItem.id == sku.stock_item_id,
                    StockItem.company_id == company_id))
            if row.base_units_per_sku is not None:
                if not item:
                    raise HTTPException(422, f"Row {number}: stock item required for units per SKU")
                if sku.base_units_per_sku and sku.base_units_per_sku != row.base_units_per_sku:
                    movement = await db.scalar(select(StockMovement.id).where(
                        StockMovement.company_id == company_id, StockMovement.sku_id == sku.id).limit(1))
                    if movement:
                        raise HTTPException(409, f"Row {number}: reverse SKU stock movements before changing pack units")
                sku.base_units_per_sku = row.base_units_per_sku
            if row.on_hand_base_units is not None:
                if not item or not sku.base_units_per_sku or not row.stock_date or not (row.stock_reason or "").strip():
                    raise HTTPException(422, f"Row {number}: on-hand total needs stock item, units per SKU, date and reason")
                previous = stock_targets.get(item.id)
                target = (row.on_hand_base_units, row.stock_date, row.stock_reason.strip())
                if previous and previous != target:
                    raise HTTPException(422, f"Row {number}: conflicting on-hand totals for shared stock item")
                stock_targets[item.id] = target
            if row.cost_per_base_unit is not None:
                if not item or not sku.base_units_per_sku or not row.cost_effective_date or not (row.cost_note or "").strip():
                    raise HTTPException(422, f"Row {number}: cost needs stock item, units per SKU, effective date and source note")
                target = (round(row.cost_per_base_unit, 4), row.cost_effective_date, row.cost_note.strip())
                previous = cost_targets.get(item.id)
                if previous and previous != target:
                    raise HTTPException(422, f"Row {number}: conflicting costs for shared stock item")
                cost_targets[item.id] = target
            price_fields = {field: getattr(row, field) for field in PRICING_FIELDS
                            if field != "reverse_shipping_charge"
                            if getattr(row, field) is not None}
            if price_fields or row.reverse_shipping_charge is not None:
                platform_name = (row.platform or "").strip()
                if platform_name.casefold() not in platforms:
                    raise HTTPException(422, f"Row {number}: choose an existing company platform for Unit Economics")
                platform_id = platforms[platform_name.casefold()]
                pricing = await db.scalar(select(SkuPricing).where(SkuPricing.company_id == company_id,
                    SkuPricing.sku_id == sku.id, SkuPricing.platform_id == platform_id))
                if pricing and price_fields:
                    for field, value in price_fields.items():
                        setattr(pricing, field + "_override" if field in
                                {"cr_cost", "damage_cost", "misc_total"} else field, value)
                elif price_fields:
                    if row.price is None:
                        raise HTTPException(422, f"Row {number}: new platform pricing needs Price / SKU")
                    defaults = {"package": 0.0, "logistics": 0.0, "addons": 0.0,
                                "profit_percentage": 20.0}
                    inputs = {**defaults, **{k: v for k, v in price_fields.items() if k in defaults}}
                    gst_rate = sku.gst_rate if sku.gst_rate is not None else (
                        sku.hsn_code.gst_rate if sku.hsn_code else None)
                    if gst_rate is None:
                        raise HTTPException(422, f"Row {number}: set Catalogue GST before creating platform pricing")
                    inputs["gst"] = gst_rate
                    resolved = await resolve_pricing_inputs(db, platform_id, company_id, row.price,
                        row.cr_percentage, row.cr_cost, row.damage_percentage, row.damage_cost, row.misc_total)
                    calcs = calculate_pricing(row.price, inputs["package"], inputs["logistics"],
                        inputs["addons"], resolved["misc_total"], resolved["cr_cost"],
                        resolved["damage_cost"], inputs["gst"], inputs["profit_percentage"])
                    pricing = SkuPricing(company_id=company_id, sku_id=sku.id, platform_id=platform_id,
                        price=row.price, **inputs, **resolved, **calcs,
                        cr_cost_override=row.cr_cost, damage_cost_override=row.damage_cost,
                        misc_total_override=row.misc_total)
                    db.add(pricing)
                    await db.flush()
                if row.reverse_shipping_charge is not None:
                    from app.services.pricing import set_reverse_shipping_override
                    await set_reverse_shipping_override(db, sku.id, platform_id, company_id,
                                                        row.reverse_shipping_charge)
                    await db.flush()
                if pricing is not None:
                    await recalculate_pricing(db, pricing)
                counts["prices"] += 1
            if row.image_file:
                for old in (await db.scalars(select(SkuImage).where(SkuImage.company_id == company_id,
                    SkuImage.sku_id == sku.id, SkuImage.is_primary.is_(True)))).all():
                    old.is_primary = False
                await db.flush()
                stem = uuid4().hex
                media_dir.mkdir(parents=True, exist_ok=True)
                full, thumb = media_dir / f"{stem}.webp", media_dir / f"{stem}_thumb.webp"
                full_bytes, thumb_bytes = images[row.image_file]
                full.write_bytes(full_bytes); written_files.append(full)
                thumb.write_bytes(thumb_bytes); written_files.append(thumb)
                db.add(SkuImage(company_id=company_id, sku_id=sku.id, file_name=full.name,
                    mime_type="image/webp", is_primary=True, alt_text=sku.display_name or sku.shringar_sku,
                    uploaded_by=user_id))
                counts["images"] += 1
        for item_id, (cost, effective, note) in cost_targets.items():
            db.add(StockCost(company_id=company_id, stock_item_id=item_id,
                cost_per_base_unit=cost, source_type="manual", source_id=None,
                effective_date=effective, note=note, approved_by=user_id))
            counts["costs"] += 1
        for item_id, (desired, movement_date, reason) in stock_targets.items():
            await db.execute(update(StockItem).where(StockItem.id == item_id,
                StockItem.company_id == company_id).values(name=StockItem.name))
            await db.scalar(select(StockItem.id).where(StockItem.id == item_id,
                StockItem.company_id == company_id).with_for_update())
            balance = await stock_balance(db, company_id, item_id)
            if balance != desired:
                db.add(StockMovement(company_id=company_id, stock_item_id=item_id,
                    movement_date=movement_date, movement_type="opening" if balance is None else "adjustment",
                    base_units_delta=desired - (balance or 0), request_key=f"bulk:{uuid4().hex}",
                    reason=reason, created_by=user_id))
                counts["stock"] += 1
        if counts["prices"]:
            await recover_unpriced_reports(db, company_id)
        await db.commit()
        return counts
    except Exception:
        await db.rollback()
        for path in written_files:
            path.unlink(missing_ok=True)
        raise
