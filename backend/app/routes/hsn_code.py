from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from app.core.database import get_db
from app.core.dependencies import require_any
from app.models.hsn_code import HsnCode
from app.schemas.hsn_code import HsnCodeCreate, HsnCodeResponse
from typing import List, Optional

router = APIRouter(prefix="/hsn", tags=["HSN Codes"])

@router.get("/", response_model=List[HsnCodeResponse])
async def list_hsn(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_any)
):
    result = await db.execute(select(HsnCode).order_by(HsnCode.code))
    return result.scalars().all()

@router.get("/search", response_model=List[HsnCodeResponse])
async def search_hsn(
    q: str,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_any)
):
    result = await db.execute(
        select(HsnCode).where(
            or_(
                HsnCode.code.ilike(f"%{q}%"),
                HsnCode.description.ilike(f"%{q}%"),
                HsnCode.category.ilike(f"%{q}%")
            )
        ).order_by(HsnCode.code).limit(20)
    )
    return result.scalars().all()

@router.post("/", response_model=HsnCodeResponse)
async def create_hsn(
    data: HsnCodeCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_any)
):
    existing = await db.execute(select(HsnCode).where(HsnCode.code == data.code))
    if existing.scalar_one_or_none():
        raise HTTPException(400, f"HSN code {data.code} already exists")
    hsn = HsnCode(**data.model_dump(), is_custom=True)
    db.add(hsn)
    await db.commit()
    await db.refresh(hsn)
    return hsn

@router.get("/{code}", response_model=HsnCodeResponse)
async def get_hsn(
    code: str,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_any)
):
    result = await db.execute(select(HsnCode).where(HsnCode.code == code))
    hsn = result.scalar_one_or_none()
    if not hsn:
        raise HTTPException(404, "HSN code not found")
    return hsn