from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.dependencies import require_admin_or_above, require_any
from app.models.global_settings import GlobalSettings
from app.schemas.global_settings import GlobalSettingUpdate, GlobalSettingResponse

router = APIRouter(prefix="/settings", tags=["Global Settings"])


@router.get("/", response_model=list[GlobalSettingResponse])
async def list_settings(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_any),
):
    result = await db.execute(select(GlobalSettings).order_by(GlobalSettings.key))
    return result.scalars().all()


@router.get("/{key}", response_model=GlobalSettingResponse)
async def get_setting(
    key: str,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_any),
):
    result = await db.execute(select(GlobalSettings).where(GlobalSettings.key == key))
    setting = result.scalar_one_or_none()
    if not setting:
        raise HTTPException(status_code=404, detail="Setting not found")
    return setting


@router.patch("/{key}", response_model=GlobalSettingResponse)
async def update_setting(
    key: str,
    payload: GlobalSettingUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin_or_above),
):
    result = await db.execute(select(GlobalSettings).where(GlobalSettings.key == key))
    setting = result.scalar_one_or_none()
    if not setting:
        raise HTTPException(status_code=404, detail="Setting not found")

    setting.value = payload.value
    if payload.description:
        setting.description = payload.description

    await db.commit()
    await db.refresh(setting)
    return setting