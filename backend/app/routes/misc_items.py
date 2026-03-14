from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.dependencies import require_admin_or_above, require_any
from app.models.misc_item import MiscItem
from app.schemas.misc_item import MiscItemCreate, MiscItemUpdate, MiscItemResponse, MiscTotalResponse

router = APIRouter(prefix="/misc-items", tags=["Misc Items"])


@router.get("/", response_model=list[MiscItemResponse])
async def list_misc_items(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_any),
):
    result = await db.execute(select(MiscItem).order_by(MiscItem.name))
    return result.scalars().all()


@router.get("/total", response_model=MiscTotalResponse)
async def get_misc_total(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_any),
):
    """Returns sum of all active misc items — used as default misc_total in pricing."""
    result = await db.execute(
        select(MiscItem).where(MiscItem.is_active == True)
    )
    items = result.scalars().all()
    return MiscTotalResponse(
        total=round(sum(i.amount for i in items), 2),
        items=items,
    )


@router.post("/", response_model=MiscItemResponse, status_code=status.HTTP_201_CREATED)
async def create_misc_item(
    payload: MiscItemCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin_or_above),
):
    item = MiscItem(name=payload.name, amount=payload.amount)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=MiscItemResponse)
async def update_misc_item(
    item_id: int,
    payload: MiscItemUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin_or_above),
):
    result = await db.execute(select(MiscItem).where(MiscItem.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Misc item not found")

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(item, field, value)

    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_misc_item(
    item_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin_or_above),
):
    result = await db.execute(select(MiscItem).where(MiscItem.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Misc item not found")
    await db.delete(item)
    await db.commit()