from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.models.company import CompanyRole
from app.schemas.company import CompanyCreate, CompanyResponse, CompanyContext
from app.services.company import create_company, list_user_companies, get_membership, get_modules

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


@router.get("/{company_id}/context", response_model=CompanyContext)
async def company_context(company_id: int, db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    row = await get_membership(db, user.id, company_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this company")
    company, role = row
    return CompanyContext(company=_resp(company, role), modules=await get_modules(db, company_id))
