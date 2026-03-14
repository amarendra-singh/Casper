from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import require_admin_or_above, require_any
from app.models.platform import Platform, PlatformTier
from app.schemas.platform import (
    PlatformCreate, PlatformUpdate, PlatformResponse,
    PlatformTierCreate, PlatformTierResponse,
)

router = APIRouter(prefix="/platforms", tags=["Platforms"])


@router.get("/", response_model=list[PlatformResponse])
async def list_platforms(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_any),
):
    result = await db.execute(
        select(Platform)
        .options(selectinload(Platform.tiers))
        .order_by(Platform.name)
    )
    return result.scalars().all()


@router.post("/", response_model=PlatformResponse, status_code=status.HTTP_201_CREATED)
async def create_platform(
    payload: PlatformCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin_or_above),
):
    existing = await db.execute(select(Platform).where(Platform.name == payload.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Platform already exists")

    platform = Platform(
        name=payload.name,
        cr_charge=payload.cr_charge,
        cr_percentage=payload.cr_percentage,
    )
    db.add(platform)
    await db.flush()  # get platform.id before adding tiers

    for tier in payload.tiers:
        db.add(PlatformTier(
            platform_id=platform.id,
            tier_name=tier.tier_name,
            fee=tier.fee,
        ))

    await db.commit()
    await db.refresh(platform)

    result = await db.execute(
        select(Platform)
        .options(selectinload(Platform.tiers))
        .where(Platform.id == platform.id)
    )
    return result.scalar_one()


@router.get("/{platform_id}", response_model=PlatformResponse)
async def get_platform(
    platform_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_any),
):
    result = await db.execute(
        select(Platform)
        .options(selectinload(Platform.tiers))
        .where(Platform.id == platform_id)
    )
    platform = result.scalar_one_or_none()
    if not platform:
        raise HTTPException(status_code=404, detail="Platform not found")
    return platform


@router.patch("/{platform_id}", response_model=PlatformResponse)
async def update_platform(
    platform_id: int,
    payload: PlatformUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin_or_above),
):
    result = await db.execute(
        select(Platform)
        .options(selectinload(Platform.tiers))
        .where(Platform.id == platform_id)
    )
    platform = result.scalar_one_or_none()
    if not platform:
        raise HTTPException(status_code=404, detail="Platform not found")

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(platform, field, value)

    await db.commit()
    await db.refresh(platform)
    return platform


@router.delete("/{platform_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_platform(
    platform_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin_or_above),
):
    result = await db.execute(select(Platform).where(Platform.id == platform_id))
    platform = result.scalar_one_or_none()
    if not platform:
        raise HTTPException(status_code=404, detail="Platform not found")
    await db.delete(platform)
    await db.commit()


# ── Tier sub-routes ───────────────────────────────────────
@router.post("/{platform_id}/tiers", response_model=PlatformTierResponse, status_code=201)
async def add_tier(
    platform_id: int,
    payload: PlatformTierCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin_or_above),
):
    result = await db.execute(select(Platform).where(Platform.id == platform_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Platform not found")

    tier = PlatformTier(platform_id=platform_id, tier_name=payload.tier_name, fee=payload.fee)
    db.add(tier)
    await db.commit()
    await db.refresh(tier)
    return tier


@router.patch("/{platform_id}/tiers/{tier_id}", response_model=PlatformTierResponse)
async def update_tier(
    platform_id: int,
    tier_id: int,
    payload: PlatformTierCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin_or_above),
):
    result = await db.execute(
        select(PlatformTier).where(
            PlatformTier.id == tier_id,
            PlatformTier.platform_id == platform_id
        )
    )
    tier = result.scalar_one_or_none()
    if not tier:
        raise HTTPException(status_code=404, detail="Tier not found")

    tier.tier_name = payload.tier_name
    tier.fee = payload.fee
    await db.commit()
    await db.refresh(tier)
    return tier


@router.delete("/{platform_id}/tiers/{tier_id}", status_code=204)
async def delete_tier(
    platform_id: int,
    tier_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin_or_above),
):
    result = await db.execute(
        select(PlatformTier).where(
            PlatformTier.id == tier_id,
            PlatformTier.platform_id == platform_id
        )
    )
    tier = result.scalar_one_or_none()
    if not tier:
        raise HTTPException(status_code=404, detail="Tier not found")
    await db.delete(tier)
    await db.commit()