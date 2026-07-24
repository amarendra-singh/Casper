from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.models.company import CompanyRole
from app.schemas.company import (
    CompanyCreate, CompanyUpdate, CompanyResponse, CompanyContext, ModulesUpdate,
    MemberResponse, MemberCreate, MemberRoleUpdate,
)
from app.services.company import (
    create_company, rename_company, archive_company,
    list_user_companies, get_membership, get_modules, set_company_modules,
    list_members, add_member, update_member_role, remove_member,
)


async def _require_owner(db, user, company_id):
    row = await get_membership(db, user.id, company_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this company")
    company, role = row
    if role != CompanyRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner only")
    return company

router = APIRouter(prefix="/companies", tags=["Companies"])


def _resp(company, role) -> CompanyResponse:
    return CompanyResponse(id=company.id, name=company.name, slug=company.slug,
                           color=company.color, role=role)


@router.get("/", response_model=list[CompanyResponse])
async def my_companies(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return [_resp(c, r) for c, r in await list_user_companies(db, user.id)]


@router.post("/", response_model=CompanyResponse, status_code=status.HTTP_201_CREATED)
async def new_company(payload: CompanyCreate, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_current_user)):
    co = await create_company(db, user.id, payload.name, payload.color or "#EC2D6E")
    await db.commit()
    await db.refresh(co)
    return _resp(co, CompanyRole.owner)


@router.patch("/{company_id}", response_model=CompanyResponse)
async def rename_company_route(company_id: int, payload: CompanyUpdate,
                              db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await _require_owner(db, user, company_id)
    co = await rename_company(db, company_id, payload.name)
    await db.commit()
    await db.refresh(co)
    return _resp(co, CompanyRole.owner)


@router.delete("/{company_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_company_route(company_id: int, db: AsyncSession = Depends(get_db),
                                user: User = Depends(get_current_user)):
    """Owner-only soft-delete. Company drops out of the switcher; data is retained."""
    await _require_owner(db, user, company_id)
    await archive_company(db, company_id)
    await db.commit()


@router.post("/{company_id}/leave", status_code=status.HTTP_204_NO_CONTENT)
async def leave_company_route(company_id: int, db: AsyncSession = Depends(get_db),
                              user: User = Depends(get_current_user)):
    """A non-owner member removes their own membership. The owner must archive instead."""
    row = await get_membership(db, user.id, company_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this company")
    _company, role = row
    if role == CompanyRole.owner:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="The owner can't leave — archive the company instead")
    await remove_member(db, company_id, user.id)
    await db.commit()


@router.get("/{company_id}/context", response_model=CompanyContext)
async def company_context(company_id: int, db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    row = await get_membership(db, user.id, company_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this company")
    company, role = row
    return CompanyContext(company=_resp(company, role), modules=await get_modules(db, company_id))


@router.patch("/{company_id}/modules", response_model=CompanyContext)
async def update_modules(company_id: int, payload: ModulesUpdate,
                         db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    row = await get_membership(db, user.id, company_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this company")
    company, role = row
    if role != CompanyRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can change modules")
    await set_company_modules(db, company_id, payload.modules)
    await db.commit()
    return CompanyContext(company=_resp(company, role), modules=await get_modules(db, company_id))


# ── Team members ─────────────────────────────────────────────────────────────

@router.get("/{company_id}/members", response_model=list[MemberResponse])
async def company_members(company_id: int, db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    if not await get_membership(db, user.id, company_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this company")
    return [MemberResponse(id=u.id, name=u.name, email=u.email, role=r)
            for u, r in await list_members(db, company_id)]


@router.post("/{company_id}/members", response_model=MemberResponse, status_code=status.HTTP_201_CREATED)
async def invite_member(company_id: int, payload: MemberCreate, db: AsyncSession = Depends(get_db),
                        user: User = Depends(get_current_user)):
    await _require_owner(db, user, company_id)
    try:
        u, role = await add_member(db, company_id, payload.email, payload.name or "",
                                   payload.password, payload.role)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    await db.commit()
    await db.refresh(u)
    return MemberResponse(id=u.id, name=u.name, email=u.email, role=role)


@router.patch("/{company_id}/members/{user_id}", response_model=MemberResponse)
async def change_member_role(company_id: int, user_id: int, payload: MemberRoleUpdate,
                             db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await _require_owner(db, user, company_id)
    m = await update_member_role(db, company_id, user_id, payload.role)
    if not m:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    await db.commit()
    from app.models.user import User as U
    target = (await db.execute(select(U).where(U.id == user_id))).scalar_one()
    return MemberResponse(id=target.id, name=target.name, email=target.email, role=payload.role)


@router.delete("/{company_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def kick_member(company_id: int, user_id: int, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_current_user)):
    company = await _require_owner(db, user, company_id)
    if user_id == company.owner_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot remove the company owner")
    if not await remove_member(db, company_id, user_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    await db.commit()
