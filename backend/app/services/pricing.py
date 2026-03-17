"""
CasperV2 — Pricing calculation service.
All business logic lives HERE, not in routes.
This keeps routes thin and logic testable.
"""

# AsyncSession is the type hint for our DB session
from sqlalchemy.ext.asyncio import AsyncSession

# select is SQLAlchemy's way of writing SELECT queries in Python
from sqlalchemy import select, func

# Our models
from app.models.platform import Platform
from app.models.misc_item import MiscItem
from app.models.global_settings import GlobalSettings
from app.models.sku import SkuPricing


async def get_platform(db: AsyncSession, platform_id: int) -> Platform:
    """Fetch platform by ID — raises ValueError if not found."""
    result = await db.execute(
        # select(Platform) = SELECT * FROM platforms
        # .where() = WHERE id = platform_id
        select(Platform).where(Platform.id == platform_id)
    )
    # scalar_one_or_none() = return single result or None (never raises error)
    platform = result.scalar_one_or_none()
    if not platform:
        raise ValueError(f"Platform {platform_id} not found")
    return platform


async def get_misc_total(db: AsyncSession) -> float:
    """Sum all active misc items — used as default misc_total."""
    result = await db.execute(
        # func.sum() = SQL SUM() aggregate function
        # MiscItem.amount = the column to sum
        # filter = WHERE is_active = True
        select(func.sum(MiscItem.amount)).filter(MiscItem.is_active == True)
    )
    # scalar() = returns single value (the sum), not a row
    # 'or 0.0' handles the case where there are no misc items (sum = NULL)
    return result.scalar() or 0.0


async def get_damage_percent(db: AsyncSession) -> float:
    """Fetch default damage % from global settings."""
    result = await db.execute(
        select(GlobalSettings).where(GlobalSettings.key == "damage_percent")
    )
    setting = result.scalar_one_or_none()
    # float() converts the stored string value to a number
    # default 15.0 if setting not found
    return float(setting.value) if setting else 15.0


def calculate_pricing(
    price: float,
    package: float,
    logistics: float,
    addons: float,
    misc_total: float,
    cr_cost: float,
    damage_cost: float,
    gst: float,
) -> dict:
    """
    Core formula — pure function (no DB needed).
    Pure functions are easiest to test and debug.
    
    Returns dict with all 4 calculated fields.
    """
    # All costs added to price to find minimum selling price
    breakeven = round(
        price + package + logistics + addons + misc_total + cr_cost + damage_cost,
        2  # round to 2 decimal places
    )

    # 20% profit on top of breakeven
    net_profit_20 = round(breakeven * 0.20, 2)

    # Bank settlement before GST — rounded to nearest integer (like your sheet)
    bs_wo_gst = round(breakeven + net_profit_20)

    # Final settlement after adding GST
    bank_settlement = round(bs_wo_gst + gst, 2)

    # Return as dict — easy to unpack into model fields
    return {
        "breakeven": breakeven,
        "net_profit_20": net_profit_20,
        "bs_wo_gst": float(bs_wo_gst),
        "bank_settlement": bank_settlement,
    }


async def resolve_pricing_inputs(
    db: AsyncSession,
    platform_id: int,
    price: float,
    cr_percentage: float | None,
    cr_cost: float | None,
    damage_percentage: float | None,
    damage_cost: float | None,
    misc_total: float | None,
) -> dict:
    """
    Resolves all auto-calculated inputs before saving.
    Priority: manually provided value > auto-calculated default.
    
    This is the "smart defaults" logic:
    - If user provides cr_cost → use it
    - If not → calculate from platform
    """
    # ── Fetch platform (always needed for CR) ─────────────
    platform = await get_platform(db, platform_id)

    # ── CR Percentage ─────────────────────────────────────
    # 'or' here means: if cr_percentage is None/0, use platform default
    resolved_cr_pct = cr_percentage if cr_percentage is not None else platform.cr_percentage

    # ── CR Cost ───────────────────────────────────────────
    # If user manually set cr_cost → respect it
    # Otherwise auto-calculate: platform charge × CR%
    if cr_cost is not None:
        resolved_cr_cost = cr_cost
    else:
        # /100 converts percentage to decimal (10% → 0.10)
        resolved_cr_cost = round(platform.cr_charge * (resolved_cr_pct / 100), 2)

    # ── Damage Percentage ─────────────────────────────────
    if damage_percentage is not None:
        resolved_dmg_pct = damage_percentage
    else:
        # Pull from global settings DB
        resolved_dmg_pct = await get_damage_percent(db)

    # ── Damage Cost ───────────────────────────────────────
    if damage_cost is not None:
        resolved_dmg_cost = damage_cost
    else:
        resolved_dmg_cost = round(price * (resolved_dmg_pct / 100), 2)

    # ── Misc Total ────────────────────────────────────────
    if misc_total is not None:
        resolved_misc = misc_total
    else:
        # Auto-sum all active misc items
        resolved_misc = await get_misc_total(db)

    # Return everything resolved — ready to calculate & save
    return {
        "cr_percentage": resolved_cr_pct,
        "cr_cost": resolved_cr_cost,
        "damage_percentage": resolved_dmg_pct,
        "damage_cost": resolved_dmg_cost,
        "misc_total": resolved_misc,
    }