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
from app.models.sku import SkuPricing, SkuReverseShipping
from decimal import Decimal, ROUND_HALF_UP


def money_round(value, places=2):
    """Round monetary values consistently with positive-value UI previews."""
    return float(Decimal(str(value)).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP))


def resolve_cost_allowances(price, cr_charge, cr_percentage, cr_cost,
                            damage_percentage, damage_cost):
    """Shared grid/API override precedence and derived allowance precision."""
    if cr_cost is not None:
        cr_percentage = cr_cost / cr_charge * 100 if cr_charge else cr_percentage
    else:
        cr_cost = money_round(cr_charge * cr_percentage / 100)
    if damage_cost is not None:
        damage_percentage = damage_cost / price * 100 if price else damage_percentage
    else:
        damage_cost = money_round(price * damage_percentage / 100)
    return dict(cr_percentage=cr_percentage, cr_cost=cr_cost,
                damage_percentage=damage_percentage, damage_cost=damage_cost)


async def recalculate_pricing(db: AsyncSession, pricing: SkuPricing) -> None:
    """Recompute the complete cost stack while preserving explicit overrides."""
    resolved = await resolve_pricing_inputs(
        db, pricing.platform_id, pricing.company_id, pricing.price,
        pricing.cr_percentage, pricing.cr_cost_override,
        pricing.damage_percentage, pricing.damage_cost_override,
        pricing.misc_total_override, sku_id=pricing.sku_id,
    )
    for field, value in resolved.items():
        setattr(pricing, field, value)
    calculated = calculate_pricing(
        pricing.price, pricing.package, pricing.logistics, pricing.addons,
        pricing.misc_total, pricing.cr_cost, pricing.damage_cost,
        pricing.gst, pricing.profit_percentage,
    )
    for field, value in calculated.items():
        setattr(pricing, field, value)


async def get_platform(db: AsyncSession, platform_id: int, company_id: int) -> Platform:
    """Fetch platform by ID — raises ValueError if not found."""
    result = await db.execute(
        # select(Platform) = SELECT * FROM platforms
        # .where() = WHERE id = platform_id
        select(Platform).where(Platform.id == platform_id, Platform.company_id == company_id)
    )
    # scalar_one_or_none() = return single result or None (never raises error)
    platform = result.scalar_one_or_none()
    if not platform:
        raise ValueError(f"Platform {platform_id} not found")
    return platform


async def get_reverse_shipping_override(db: AsyncSession, sku_id: int, platform_id: int,
                                        company_id: int) -> float | None:
    """Return this SKU/platform override, including an explicit zero."""
    return await db.scalar(
        select(SkuReverseShipping.charge).where(
            SkuReverseShipping.sku_id == sku_id,
            SkuReverseShipping.company_id == company_id,
            SkuReverseShipping.platform_id == platform_id)
    )


async def set_reverse_shipping_override(db: AsyncSession, sku_id: int, platform_id: int,
                                        company_id: int, charge: float | None) -> None:
    record = await db.scalar(select(SkuReverseShipping).where(
        SkuReverseShipping.sku_id == sku_id,
        SkuReverseShipping.company_id == company_id,
        SkuReverseShipping.platform_id == platform_id))
    if charge is None:
        if record:
            await db.delete(record)
    elif record:
        record.charge = charge
    else:
        db.add(SkuReverseShipping(company_id=company_id, sku_id=sku_id,
                                  platform_id=platform_id, charge=charge))


# company_id is REQUIRED on both: unscoped, these summed every tenant's misc
# items and read another tenant's settings into this company's breakeven.
async def get_misc_total(db: AsyncSession, company_id: int) -> float:
    """Sum this company's active misc items — the default misc_total."""
    result = await db.execute(
        select(func.sum(MiscItem.amount)).filter(
            MiscItem.is_active == True,
            MiscItem.company_id == company_id,
        )
    )
    # NULL when the company has no misc items at all.
    return result.scalar() or 0.0


async def get_damage_percent(db: AsyncSession, company_id: int) -> float:
    """This company's default damage %, falling back to the app default."""
    result = await db.execute(
        select(GlobalSettings).where(
            GlobalSettings.key == "damage_percent",
            GlobalSettings.company_id == company_id,
        )
    )
    setting = result.scalar_one_or_none()
    return float(setting.value) if setting else 15.0


def calculate_pricing(
    price: float,
    package: float,
    logistics: float,
    addons: float,
    misc_total: float,
    cr_cost: float,
    damage_cost: float,
    gst: float,                      # GST rate in % (e.g. 5 means 5%)
    profit_percentage: float = 20.0, # profit % on top of breakeven
) -> dict:
    """
    Core formula — pure function (no DB needed).
    Pure functions are easiest to test and debug.

    Returns dict with all 4 calculated fields.
    """
    # All costs added to price to find minimum selling price
    breakeven = money_round(sum(Decimal(str(v)) for v in
        (price, package, logistics, addons, misc_total, cr_cost, damage_cost)))

    # profit % on top of breakeven
    net_profit_amt = money_round(Decimal(str(breakeven)) * Decimal(str(profit_percentage)) / 100)

    # Bank settlement before GST — rounded to nearest integer
    bs_wo_gst = money_round(Decimal(str(breakeven)) + Decimal(str(net_profit_amt)), 0)

    # GST is a rate (%), not a flat ₹ amount
    gst_amount = money_round(Decimal(str(bs_wo_gst)) * Decimal(str(gst)) / 100)
    bank_settlement = money_round(Decimal(str(bs_wo_gst)) + Decimal(str(gst_amount)))

    return {
        "breakeven": breakeven,
        "net_profit_amt": net_profit_amt,
        "bs_wo_gst": float(bs_wo_gst),
        "bank_settlement": bank_settlement,
    }


async def resolve_pricing_inputs(
    db: AsyncSession,
    platform_id: int,
    company_id: int,
    price: float,
    cr_percentage: float | None,
    cr_cost: float | None,
    damage_percentage: float | None,
    damage_cost: float | None,
    misc_total: float | None,
    sku_id: int | None = None,
) -> dict:
    """
    Resolves all auto-calculated inputs before saving.
    Priority: manually provided value > auto-calculated default.
    
    This is the "smart defaults" logic:
    - If user provides cr_cost → use it
    - If not → calculate from platform
    """
    # ── Fetch platform (always needed for CR) ─────────────
    platform = await get_platform(db, platform_id, company_id)
    shipping_override = (await get_reverse_shipping_override(db, sku_id, platform_id, company_id)
                         if sku_id is not None else None)
    reverse_shipping_charge = (platform.cr_charge if shipping_override is None
                               else shipping_override)

    # ── CR Percentage ─────────────────────────────────────
    # An explicit zero overrides the platform default.
    resolved_cr_pct = cr_percentage if cr_percentage is not None else platform.cr_percentage

    # Resolve defaults before the shared allowance calculation.
    if damage_percentage is not None:
        resolved_dmg_pct = damage_percentage
    else:
        # Pull from global settings DB
        resolved_dmg_pct = await get_damage_percent(db, company_id)

    # Explicit miscellaneous overrides also preserve zero.
    if misc_total is not None:
        resolved_misc = misc_total
    else:
        # Auto-sum all active misc items
        resolved_misc = await get_misc_total(db, company_id)

    # Return everything resolved — ready to calculate & save
    return {**resolve_cost_allowances(price, reverse_shipping_charge, resolved_cr_pct, cr_cost,
                                     resolved_dmg_pct, damage_cost), "misc_total": resolved_misc}
