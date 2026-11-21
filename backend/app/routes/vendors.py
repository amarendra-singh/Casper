from app.core.dependencies import require_company_role
from app.models.company import CompanyRole
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.dependencies import require_admin_or_above, require_any, get_active_company, get_company_scope
from app.models.vendor import Vendor
from app.schemas.vendor import VendorCreate, VendorUpdate, VendorResponse

router = APIRouter(prefix="/vendors", tags=["Vendors"])


@router.get("/", response_model=list[VendorResponse])
async def list_vendors(
    db: AsyncSession = Depends(get_db),
    scope=Depends(get_company_scope),
    _=Depends(require_any),
):
    result = await db.execute(select(Vendor).where(Vendor.company_id.in_(scope.ids)).order_by(Vendor.name))
    return result.scalars().all()


@router.post("/", response_model=VendorResponse, status_code=status.HTTP_201_CREATED)
async def create_vendor(
    payload: VendorCreate,
    db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin)),
    _=Depends(require_any),
):
    from app.services.vendor_identity import resolve_vendor
    for identity in (payload.name, payload.short_code):
        if await resolve_vendor(db, company.id, identity) is not None:
            raise HTTPException(409, 'Vendor name or code identifies an existing supplier')
    short_code = payload.short_code.strip().upper()
    existing = await db.execute(select(Vendor).where(Vendor.short_code == short_code, Vendor.company_id == company.id))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Vendor short code already exists")

    vendor = Vendor(name=payload.name, short_code=short_code, company_id=company.id)
    db.add(vendor)
    await db.commit()
    await db.refresh(vendor)
    return vendor


@router.get("/{vendor_id}", response_model=VendorResponse)
async def get_vendor(
    vendor_id: int,
    db: AsyncSession = Depends(get_db),
    company=Depends(get_active_company),
    _=Depends(require_any),
):
    result = await db.execute(select(Vendor).where(Vendor.company_id == company.id, Vendor.id == vendor_id))
    vendor = result.scalar_one_or_none()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return vendor


@router.patch("/{vendor_id}", response_model=VendorResponse)
async def update_vendor(
    vendor_id: int,
    payload: VendorUpdate,
    db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin)),
    _=Depends(require_any),
):
    result = await db.execute(select(Vendor).where(Vendor.company_id == company.id, Vendor.id == vendor_id))
    vendor = result.scalar_one_or_none()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    from app.services.vendor_identity import resolve_vendor
    for identity in (payload.name, payload.short_code):
        if identity:
            matched = await resolve_vendor(db, company.id, identity)
            if matched is not None and matched != vendor.id:
                raise HTTPException(409, 'Vendor name or code identifies another supplier')
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(vendor, field, value)

    await db.commit()
    await db.refresh(vendor)
    return vendor


@router.delete("/{vendor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_vendor(
    vendor_id: int,
    db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin)),
    _=Depends(require_any),
):
    result = await db.execute(select(Vendor).where(Vendor.company_id == company.id, Vendor.id == vendor_id))
    vendor = result.scalar_one_or_none()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    await db.delete(vendor)
    await db.commit()

from pydantic import BaseModel, Field
from app.models.vendor import VendorNameAlias
from app.services.vendor_identity import normalize_name, resolve_vendor
from sqlalchemy.exc import IntegrityError

class VendorAliasInput(BaseModel):
    name: str = Field(min_length=1, max_length=150)

@router.get('/{vendor_id}/aliases')
async def list_vendor_aliases(vendor_id: int, db: AsyncSession = Depends(get_db),
    scope=Depends(get_company_scope), _=Depends(require_any)):
    vendor = await db.scalar(select(Vendor).where(Vendor.id == vendor_id, Vendor.company_id.in_(scope.ids)))
    if vendor is None:
        raise HTTPException(404, 'Vendor not found')
    aliases = (await db.scalars(select(VendorNameAlias).where(VendorNameAlias.vendor_id == vendor.id,
        VendorNameAlias.company_id == vendor.company_id).order_by(VendorNameAlias.name))).all()
    return [{'id': a.id, 'name': a.name} for a in aliases]

@router.post('/{vendor_id}/aliases')
async def add_vendor_alias(vendor_id: int, payload: VendorAliasInput, db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin))):
    vendor = await db.scalar(select(Vendor).where(Vendor.id == vendor_id, Vendor.company_id == company.id))
    if vendor is None:
        raise HTTPException(404, 'Vendor not found')
    name = normalize_name(payload.name)
    if not name:
        raise HTTPException(422, 'Name cannot be blank')
    resolved = await resolve_vendor(db, company.id, name)
    if resolved is not None and resolved != vendor.id:
        raise HTTPException(409, 'This name identifies another supplier')
    existing = await db.scalar(select(VendorNameAlias).where(VendorNameAlias.company_id == company.id, VendorNameAlias.name == name))
    if existing:
        return {'id': existing.id, 'name': existing.name}
    alias = VendorNameAlias(company_id=company.id, vendor_id=vendor.id, name=name)
    db.add(alias)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, 'Supplier name changed concurrently; refresh and retry') from exc
    return {'id': alias.id, 'name': alias.name}

@router.delete('/{vendor_id}/aliases/{alias_id}')
async def remove_vendor_alias(vendor_id: int, alias_id: int, db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin))):
    alias = await db.scalar(select(VendorNameAlias).where(VendorNameAlias.id == alias_id,
        VendorNameAlias.vendor_id == vendor_id, VendorNameAlias.company_id == company.id))
    if alias is None:
        raise HTTPException(404, 'Supplier name not found')
    await db.delete(alias); await db.commit()
    return {'ok': True}
