from app.core.dependencies import require_company_role
from app.models.company import CompanyRole
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.dependencies import require_admin_or_above, require_any, get_active_company, get_company_scope
from app.models.global_settings import GlobalSettings
from app.schemas.global_settings import GlobalSettingUpdate, GlobalSettingResponse

router = APIRouter(prefix="/settings", tags=["Global Settings"])


@router.get("/", response_model=list[GlobalSettingResponse])
async def list_settings(
    db: AsyncSession = Depends(get_db),
    scope=Depends(get_company_scope),
    _=Depends(require_any),
):
    result = await db.execute(select(GlobalSettings).where(GlobalSettings.company_id.in_(scope.ids)).order_by(GlobalSettings.key))
    return result.scalars().all()


@router.get("/{key}", response_model=GlobalSettingResponse)
async def get_setting(
    key: str,
    company=Depends(get_active_company),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_any),
):
    result = await db.execute(select(GlobalSettings).where(GlobalSettings.key == key, GlobalSettings.company_id == company.id))
    setting = result.scalar_one_or_none()
    if not setting:
        raise HTTPException(status_code=404, detail="Setting not found")
    return setting


@router.patch("/{key}", response_model=GlobalSettingResponse)
async def update_setting(
    key: str,
    payload: GlobalSettingUpdate,
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin)),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_any),
):
    result = await db.execute(select(GlobalSettings).where(GlobalSettings.key == key, GlobalSettings.company_id == company.id))
    setting = result.scalar_one_or_none()
    if not setting:
        raise HTTPException(status_code=404, detail="Setting not found")

    if key == 'damage_percent':
        import math
        try:
            value = float(payload.value)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="Damage percentage must be numeric")
        if not math.isfinite(value) or not 0 <= value <= 100:
            raise HTTPException(status_code=422, detail="Damage percentage must be between 0 and 100")
    setting.value = payload.value
    if payload.description:
        setting.description = payload.description

    await db.commit()
    await db.refresh(setting)
    return setting