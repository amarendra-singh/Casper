from app.core.dependencies import require_company_role
from app.models.company import CompanyRole
"""
CasperV2 — SKU and Pricing routes
"""

# APIRouter groups related routes together
# Depends = FastAPI's dependency injection system
# HTTPException = raises HTTP errors with proper status codes
from app.services.tenant_refs import validate_references
from fastapi import APIRouter, Depends, HTTPException, status

# AsyncSession = async database session type
from sqlalchemy.ext.asyncio import AsyncSession

# select = build SELECT queries, selectinload = eager load relationships
from sqlalchemy import select
from sqlalchemy.orm import selectinload

# Our DB session dependency
from app.core.database import get_db

# Role guards — who can access what
from app.core.dependencies import require_admin_or_above, require_any, get_active_company, get_company_scope, require_role_in_company

# DB models
from app.models.sku import Sku, SkuPricing, SkuReverseShipping
from app.models.platform import Platform

# Pydantic schemas for request/response
from app.schemas.sku import (
    SkuCreate, SkuUpdate, SkuResponse,
    PricingCreate, PricingUpdate, PricingResponse,
)

# Business logic service
from app.services.pricing import resolve_pricing_inputs, calculate_pricing

# Two routers — one for SKUs, one for pricing
# prefix means all routes start with /skus or /pricing
sku_router = APIRouter(prefix="/skus", tags=["SKUs"])
pricing_router = APIRouter(prefix="/pricing", tags=["Pricing"])


# ══════════════════════════════════════════════════════════
#  SKU Routes
# ══════════════════════════════════════════════════════════

# response_model=list[SkuResponse] tells FastAPI to validate 
# and serialize the response as a list of SkuResponse objects
@sku_router.get("/", response_model=list[SkuResponse])
async def list_skus(
    # Depends(get_db) injects a DB session automatically
    db: AsyncSession = Depends(get_db),
    scope=Depends(get_company_scope),
    # _ means we don't use the return value, just enforce the auth
    _=Depends(require_any),
):
    result = await db.execute(
        select(Sku)
        .where(Sku.company_id.in_(scope.ids))
        # order_by = ORDER BY shringar_sku ASC
        .order_by(Sku.shringar_sku)
    )
    # scalars() = get all rows as Python objects (not raw tuples)
    # all() = fetch all results into a list
    return result.scalars().all()


@sku_router.get("/{sku_id}", response_model=SkuResponse)
async def get_sku(
    # {sku_id} in path becomes a function parameter automatically
    sku_id: int,
    db: AsyncSession = Depends(get_db),
    scope=Depends(get_company_scope),
    _=Depends(require_any),
):
    result = await db.execute(select(Sku).where(Sku.id == sku_id, Sku.company_id.in_(scope.ids)))
    sku = result.scalar_one_or_none()
    if not sku:
        # 404 = resource not found HTTP status code
        raise HTTPException(status_code=404, detail="SKU not found")
    return sku


# status_code=201 = HTTP 201 Created (more specific than default 200)
@sku_router.post("/", response_model=SkuResponse, status_code=status.HTTP_201_CREATED)
async def create_sku(
    # payload = the request body, automatically parsed by Pydantic
    payload: SkuCreate,
    db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin)),
    _=Depends(require_any),
):
    # Check if shringar_sku already exists in THIS company — must be unique
    existing = await db.execute(
        select(Sku).where(Sku.shringar_sku == payload.shringar_sku, Sku.company_id == company.id)
    )
    if existing.scalar_one_or_none():
        # 400 = Bad Request — client sent invalid data
        raise HTTPException(status_code=400, detail="Shringar SKU already exists")

    # ** unpacks dict into keyword arguments
    # model_dump() converts Pydantic model to plain dict
    try:
        await validate_references(db, company.id, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    if (payload.reverse_shipping_platform_id is None) != (payload.reverse_shipping_charge is None):
        raise HTTPException(422, "Select a platform and charge together")
    if payload.reverse_shipping_platform_id is not None and not await db.scalar(
        select(Platform.id).where(Platform.id == payload.reverse_shipping_platform_id,
                                  Platform.company_id == company.id)):
        raise HTTPException(404, "Platform not found in this company")
    sku = Sku(**payload.model_dump(exclude={"reverse_shipping_platform_id", "reverse_shipping_charge"}),
              company_id=company.id)
    db.add(sku)       # stage the insert (not committed yet)
    await db.flush()
    if payload.reverse_shipping_platform_id is not None:
        db.add(SkuReverseShipping(company_id=company.id, sku_id=sku.id,
            platform_id=payload.reverse_shipping_platform_id,
            charge=payload.reverse_shipping_charge))
    await db.commit() # actually write to DB
    await db.refresh(sku)  # reload from DB to get generated id, timestamps
    return sku


# Editing an EXISTING record is unambiguous even in master mode — the row carries
# its own company_id — so these resolve the caller's whole scope, then authorise
# against the company that actually owns the row. Creating still needs one active
# company, so the POST routes above keep get_active_company.

@sku_router.patch("/{sku_id}", response_model=SkuResponse)
async def update_sku(
    sku_id: int,
    payload: SkuUpdate,
    db: AsyncSession = Depends(get_db),
    scope=Depends(get_company_scope),
    user=Depends(require_any),
):
    result = await db.execute(select(Sku).where(Sku.id == sku_id, Sku.company_id.in_(scope.ids)))
    sku = result.scalar_one_or_none()
    if not sku:
        raise HTTPException(status_code=404, detail="SKU not found")
    await require_role_in_company(db, user, sku.company_id)

    # model_dump(exclude_none=True) = only fields the user actually sent
    # exclude_none=True skips fields that are None (not provided)
    # setattr(obj, 'name', value) = obj.name = value dynamically
    try:
        await validate_references(db, sku.company_id, payload.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(sku, field, value)

    await db.commit()
    await db.refresh(sku)
    return sku


@sku_router.delete("/{sku_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sku(
    sku_id: int,
    db: AsyncSession = Depends(get_db),
    scope=Depends(get_company_scope),
    user=Depends(require_any),
):
    result = await db.execute(select(Sku).where(Sku.id == sku_id, Sku.company_id.in_(scope.ids)))
    sku = result.scalar_one_or_none()
    if not sku:
        raise HTTPException(status_code=404, detail="SKU not found")
    await require_role_in_company(db, user, sku.company_id)
    from app.models.catalogue import SkuImage, StockMovement
    if await db.scalar(select(StockMovement.id).where(
        StockMovement.company_id == sku.company_id, StockMovement.sku_id == sku.id).limit(1)):
        raise HTTPException(status_code=409, detail="SKU has stock history. Archive it instead of deleting.")
    if await db.scalar(select(SkuImage.id).where(
        SkuImage.company_id == sku.company_id, SkuImage.sku_id == sku.id).limit(1)):
        raise HTTPException(status_code=409, detail="Remove product images before deleting this SKU.")
    await db.delete(sku)  # stage the delete
    await db.commit()     # execute it
    # 204 = No Content — success but nothing to return


# ══════════════════════════════════════════════════════════
#  Pricing Routes
# ══════════════════════════════════════════════════════════

@pricing_router.get("/sku/{sku_id}", response_model=list[PricingResponse])
async def list_pricing_for_sku(
    sku_id: int,
    db: AsyncSession = Depends(get_db),
    scope=Depends(get_company_scope),
    _=Depends(require_any),
):
    """Get all platform pricing rows for a single SKU."""
    result = await db.execute(
        select(SkuPricing)
        .where(SkuPricing.sku_id == sku_id, SkuPricing.company_id.in_(scope.ids))
        .order_by(SkuPricing.platform_id)
    )
    return result.scalars().all()


@pricing_router.post("/", response_model=PricingResponse, status_code=status.HTTP_201_CREATED)
async def create_pricing(
    payload: PricingCreate,
    db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin)),
    _=Depends(require_any),
):
    """
    Create pricing for a SKU on a platform.
    Auto-calculates CR cost, damage cost, misc total,
    breakeven, net profit, BS w/o GST, bank settlement.
    """
    # Check duplicate — same SKU + platform combo within this company
    existing = await db.execute(
        select(SkuPricing).where(
            SkuPricing.sku_id == payload.sku_id,
            SkuPricing.platform_id == payload.platform_id,
            SkuPricing.company_id == company.id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Pricing already exists for this SKU + Platform")

    try:
        await validate_references(db, company.id, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    # Step 1: Resolve all inputs (use provided values or auto-calculate defaults)
    try:
        resolved = await resolve_pricing_inputs(
            db=db,
            platform_id=payload.platform_id,
            company_id=company.id,
            price=payload.price,
            cr_percentage=payload.cr_percentage,
            cr_cost=payload.cr_cost,
            damage_percentage=payload.damage_percentage,
            damage_cost=payload.damage_cost,
            misc_total=payload.misc_total,
            sku_id=payload.sku_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    # Step 2: Run the core formula
    calcs = calculate_pricing(
        price=payload.price,
        package=payload.package,
        logistics=payload.logistics,
        addons=payload.addons,
        misc_total=resolved["misc_total"],
        cr_cost=resolved["cr_cost"],
        damage_cost=resolved["damage_cost"],
        gst=payload.gst,
        profit_percentage=payload.profit_percentage,
    )

    # Step 3: Build and save the pricing record
    # {**a, **b} merges two dicts — inputs + resolved + calculated
    pricing = SkuPricing(
        company_id=company.id,
        sku_id=payload.sku_id,
        platform_id=payload.platform_id,
        price=payload.price,
        package=payload.package,
        logistics=payload.logistics,
        addons=payload.addons,
        gst=payload.gst,
        profit_percentage=payload.profit_percentage,
        cr_cost_override=payload.cr_cost,
        damage_cost_override=payload.damage_cost,
        misc_total_override=payload.misc_total,
        **resolved,   # cr_percentage, cr_cost, damage_percentage, damage_cost, misc_total
        **calcs,      # breakeven, net_profit_amt, bs_wo_gst, bank_settlement
    )

    db.add(pricing)
    from app.services.pnl_statement import recover_unpriced_reports
    await recover_unpriced_reports(db, company.id)
    await db.commit()
    await db.refresh(pricing)
    return pricing


@pricing_router.patch("/{pricing_id}", response_model=PricingResponse)
async def update_pricing(
    pricing_id: int,
    payload: PricingUpdate,
    db: AsyncSession = Depends(get_db),
    scope=Depends(get_company_scope),
    user=Depends(require_any),
):
    """
    Update any pricing field.
    All calculations automatically recompute after any change.
    """
    result = await db.execute(
        select(SkuPricing).where(SkuPricing.id == pricing_id, SkuPricing.company_id.in_(scope.ids))
    )
    pricing = result.scalar_one_or_none()
    if not pricing:
        raise HTTPException(status_code=404, detail="Pricing not found")
    await require_role_in_company(db, user, pricing.company_id)

    # Apply user-provided updates to the existing pricing object
    updates = payload.model_dump(exclude_unset=True)
    try:
        await validate_references(db, pricing.company_id, updates)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    for field, value in updates.items():
        if field in ('cr_cost', 'damage_cost', 'misc_total'):
            setattr(pricing, field + '_override', value)
        elif value is not None:
            setattr(pricing, field, value)

    # Re-resolve inputs using latest values (mix of updated + existing)
    # getattr(obj, 'field') = obj.field — reads attribute dynamically
    resolved = await resolve_pricing_inputs(
        db=db,
        platform_id=pricing.platform_id,
        company_id=pricing.company_id,
        price=pricing.price,
        cr_percentage=pricing.cr_percentage,
        cr_cost=pricing.cr_cost_override,
        damage_percentage=pricing.damage_percentage,
        damage_cost=pricing.damage_cost_override,
        misc_total=pricing.misc_total_override,
        sku_id=pricing.sku_id,
    )

    # Apply resolved values back
    for field, value in resolved.items():
        setattr(pricing, field, value)

    # Recalculate everything from scratch
    calcs = calculate_pricing(
        price=pricing.price,
        package=pricing.package,
        logistics=pricing.logistics,
        addons=pricing.addons,
        misc_total=pricing.misc_total,
        cr_cost=pricing.cr_cost,
        damage_cost=pricing.damage_cost,
        gst=pricing.gst,
        profit_percentage=pricing.profit_percentage,
    )

    # Apply calculated values
    for field, value in calcs.items():
        setattr(pricing, field, value)

    from app.services.pnl_statement import recover_unpriced_reports
    await recover_unpriced_reports(db, pricing.company_id)
    await db.commit()
    await db.refresh(pricing)
    return pricing


@pricing_router.delete("/{pricing_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pricing(
    pricing_id: int,
    db: AsyncSession = Depends(get_db),
    scope=Depends(get_company_scope),
    user=Depends(require_any),
):
    result = await db.execute(select(SkuPricing).where(SkuPricing.id == pricing_id, SkuPricing.company_id.in_(scope.ids)))
    pricing = result.scalar_one_or_none()
    if not pricing:
        raise HTTPException(status_code=404, detail="Pricing not found")
    await require_role_in_company(db, user, pricing.company_id)
    await db.delete(pricing)
    await db.commit()

@pricing_router.post("/refresh-preview")
async def preview_pricing_refresh(db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin))):
    from app.services.pricing_refresh import build_refresh_plan
    return await build_refresh_plan(db, company.id)


from pydantic import BaseModel, Field
class PricingRefreshInput(BaseModel):
    token: str = Field(min_length=64, max_length=64)


@pricing_router.post("/refresh-apply")
async def apply_pricing_refresh(payload: PricingRefreshInput, db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin))):
    from app.services.pricing_refresh import apply_refresh_plan
    try:
        return await apply_refresh_plan(db, company.id, payload.token)
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(409, str(exc)) from exc
