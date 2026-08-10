from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, get_active_company, require_admin_or_above, get_company_scope, require_role_in_company, require_any
from app.services.scope import company_ids
from app.models.user import User
from app.models.ledger import LedgerEntry
from app.schemas.ledger import (
    LedgerEntryCreate, LedgerEntryUpdate, LedgerEntryResponse, LedgerSummary,
)
from app.services.ledger import compute_ledger_summary, resolve_names

router = APIRouter(prefix="/ledger", tags=["Ledger"])


def _to_response(e: LedgerEntry, vmap: dict, smap: dict, co: dict | None = None) -> LedgerEntryResponse:
    r = LedgerEntryResponse.model_validate(e)
    r.vendor_name = vmap.get(e.vendor_id)
    r.sku_code = smap.get(e.sku_id)
    if co:
        r.company_id = e.company_id
        r.company_name, r.company_color = co.get(e.company_id, (None, None))
    return r

async def _company_meta(db, cids) -> dict:
    """{id: (name, colour)} — only looked up when the scope spans several companies,
    so single-company responses carry no company fields and no extra query."""
    if len(cids) < 2:
        return {}
    from sqlalchemy import select as _select
    from app.models.company import Company
    rows = await db.execute(_select(Company.id, Company.name, Company.color).where(Company.id.in_(cids)))
    return {cid: (name, color) for cid, name, color in rows.all()}



@router.get("/", response_model=list[LedgerEntryResponse])
async def list_entries(
    db: AsyncSession = Depends(get_db),
    scope=Depends(get_company_scope),
    _=Depends(get_current_user),
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
    direction: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    vendor_id: Optional[int] = Query(None),
    sku_id: Optional[int] = Query(None),
):
    conds = [LedgerEntry.company_id.in_(scope.ids)]
    if start:     conds.append(LedgerEntry.entry_date >= start)
    if end:       conds.append(LedgerEntry.entry_date <= end)
    if direction: conds.append(LedgerEntry.direction == direction)
    if category:  conds.append(LedgerEntry.category == category)
    if vendor_id: conds.append(LedgerEntry.vendor_id == vendor_id)
    if sku_id:    conds.append(LedgerEntry.sku_id == sku_id)

    result = await db.execute(
        select(LedgerEntry).where(and_(*conds))
        .order_by(LedgerEntry.entry_date.desc(), LedgerEntry.id.desc())
    )
    entries = result.scalars().all()
    vmap, smap = await resolve_names(db, scope.ids)
    co = await _company_meta(db, scope.ids)
    return [_to_response(e, vmap, smap, co) for e in entries]


@router.get("/summary", response_model=LedgerSummary)
async def ledger_summary(
    db: AsyncSession = Depends(get_db),
    scope=Depends(get_company_scope),
    _=Depends(get_current_user),
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
    direction: Optional[str] = Query(None),
):
    return await compute_ledger_summary(db, scope.ids, start, end, direction)


@router.post("/", response_model=LedgerEntryResponse, status_code=status.HTTP_201_CREATED)
async def create_entry(
    payload: LedgerEntryCreate,
    db: AsyncSession = Depends(get_db),
    company=Depends(get_active_company),
    user: User = Depends(require_admin_or_above),
):
    entry = LedgerEntry(**payload.model_dump(), company_id=company.id, created_by=user.id)
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    vmap, smap = await resolve_names(db, company.id)
    return _to_response(entry, vmap, smap)


async def _owned(db, entry_id, company_id) -> LedgerEntry:
    """`company_id` may be a single id (writes) or a whole scope (consolidated read)."""
    e = (await db.execute(
        select(LedgerEntry).where(LedgerEntry.id == entry_id,
                                  LedgerEntry.company_id.in_(company_ids(company_id)))
    )).scalar_one_or_none()
    if not e:
        raise HTTPException(status_code=404, detail="Ledger entry not found")
    return e


# Editing an EXISTING record is unambiguous even in master mode — the row carries
# its own company_id — so these resolve the caller's whole scope and then authorise
# against the company that actually owns the record. Creating is different (a new
# row has no company yet) and still goes through get_active_company.

@router.patch("/{entry_id}", response_model=LedgerEntryResponse)
async def update_entry(
    entry_id: int,
    payload: LedgerEntryUpdate,
    db: AsyncSession = Depends(get_db),
    scope=Depends(get_company_scope),
    user: User = Depends(require_any),
):
    entry = await _owned(db, entry_id, scope.ids)
    await require_role_in_company(db, user, entry.company_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(entry, field, value)
    await db.commit()
    await db.refresh(entry)
    vmap, smap = await resolve_names(db, entry.company_id)
    return _to_response(entry, vmap, smap)


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entry(
    entry_id: int,
    db: AsyncSession = Depends(get_db),
    scope=Depends(get_company_scope),
    user: User = Depends(require_any),
):
    entry = await _owned(db, entry_id, scope.ids)
    await require_role_in_company(db, user, entry.company_id)
    await db.delete(entry)
    await db.commit()
