"""
Entry upsert service.
Handles create-or-update of SKU + Pricing in a single transaction.
AD is now per-platform via SkuPlatformConfig; the base breakeven excludes AD.
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import List, Optional, Tuple

from app.schemas.entries import EntryRowInput, EntryRowResult
from app.models.sku import Sku, SkuPricing, SkuPlatformConfig
from app.models.platform import Platform
from app.models.global_settings import GlobalSettings
from app.models.misc_item import MiscItem


async def get_misc_total(session: AsyncSession) -> float:
    """Sum all active misc items."""
    result = await session.execute(
        select(MiscItem).where(MiscItem.is_active == True)
    )
    items = result.scalars().all()
    return sum(item.amount for item in items)


async def get_damage_percent(session: AsyncSession) -> float:
    result = await session.execute(
        select(GlobalSettings).where(GlobalSettings.key == 'damage_percent')
    )
    setting = result.scalar_one_or_none()
    return float(setting.value) if setting else 15.0


async def get_platforms(session: AsyncSession) -> List[Platform]:
    """Get all active platforms."""
    result = await session.execute(
        select(Platform).where(Platform.is_active == True)
    )
    return result.scalars().all()


def calculate_pricing(
    price: float,
    package: float,
    logistics: float,
    addons: float,
    misc_total: float,
    cr_percentage: float,
    cr_cost: float,
    damage_percentage: float,
    damage_cost: float,
    profit_percentage: float,
    gst_rate: float,          # GST rate in % (e.g. 5 means 5%)
) -> dict:
    """
    Core pricing formula — base breakeven excludes AD (AD is per-platform).
    Returns all calculated fields.
    """
    breakeven   = price + package + logistics + addons + misc_total + cr_cost + damage_cost
    net_profit  = breakeven * (profit_percentage / 100)
    bs_wo_gst       = round(breakeven + net_profit, 2)
    gst_amount      = round(bs_wo_gst * gst_rate / 100, 2)
    bank_settlement = round(bs_wo_gst + gst_amount, 2)

    return {
        'breakeven':        round(breakeven, 2),
        'net_profit_pct':   round(profit_percentage, 2),
        'net_profit_amt':   round(net_profit, 2),
        'bs_wo_gst':        bs_wo_gst,
        'bank_settlement':  bank_settlement,
    }


async def _upsert_sku(session: AsyncSession, row: EntryRowInput, company_id: int) -> Sku:
    """Create or update the base Sku record (identity + metadata, no pricing)."""
    result = await session.execute(
        select(Sku).where(Sku.shringar_sku == row.shringar_sku, Sku.company_id == company_id)
    )
    sku = result.scalar_one_or_none()

    if sku:
        # Partial update — only overwrite fields the client explicitly provided
        for field in ("vendor_id", "category_id", "hsn_code_id",
                      "description", "vendor_sku", "series"):
            val = getattr(row, field)
            if val is not None:
                setattr(sku, field, val)
        return sku

    sku = Sku(
        company_id   = company_id,
        shringar_sku = row.shringar_sku,
        vendor_sku   = row.vendor_sku or '',
        series       = row.series,
        vendor_id    = row.vendor_id,
        category_id  = row.category_id,
        hsn_code_id  = row.hsn_code_id,
        description  = row.description,
        is_active    = True,
    )
    session.add(sku)
    await session.flush()
    return sku


def _resolve_pricing_inputs(
    row: EntryRowInput,
    misc_default: float,
    damage_default: float,
    profit_default: float,
    pl0: Optional[Platform],
) -> dict:
    """
    Resolve all numeric inputs for the pricing formula, applying defaults
    and back-computing percentages from absolute amounts when given.
    Returns a dict ready to pass to calculate_pricing().
    """
    misc_total = row.misc_total        if row.misc_total        is not None else misc_default
    dmg_pct    = row.damage_percentage if row.damage_percentage is not None else damage_default
    profit_pct = row.profit_percentage if row.profit_percentage is not None else profit_default

    cr_pct = row.cr_percentage if row.cr_percentage is not None else (
        pl0.cr_percentage if pl0 else 10.0
    )

    # CR: prefer explicit cost, else derive from percentage × platform's cr_charge
    if row.cr_cost is not None:
        cr_cost = row.cr_cost
        cr_pct  = (cr_cost / pl0.cr_charge * 100) if pl0 and pl0.cr_charge else cr_pct
    else:
        cr_cost = (pl0.cr_charge * cr_pct / 100) if pl0 else 0

    # Damage: prefer explicit cost, else derive from percentage × price
    if row.damage_cost is not None:
        damage_cost = row.damage_cost
        dmg_pct     = (damage_cost / row.price * 100) if row.price else dmg_pct
    else:
        damage_cost = row.price * dmg_pct / 100

    return dict(
        price             = row.price,
        package           = row.package or 0,
        logistics         = row.logistics or 0,
        addons            = row.addons or 0,
        misc_total        = misc_total,
        cr_percentage     = cr_pct,
        cr_cost           = cr_cost,
        damage_percentage = dmg_pct,
        damage_cost       = damage_cost,
        profit_percentage = profit_pct,
        gst_rate          = row.gst or 0,
    )


async def _upsert_pricing(
    session: AsyncSession,
    sku: Sku,
    platform: Platform,
    inputs: dict,
    calc: dict,
) -> SkuPricing:
    """
    Create or update the base SkuPricing row (one per SKU, attached to the
    first/default platform). Per-platform AD lives in SkuPlatformConfig.
    """
    pricing_data = dict(
        company_id        = sku.company_id,
        sku_id            = sku.id,
        platform_id       = platform.id,
        price             = inputs["price"],
        package           = inputs["package"],
        logistics         = inputs["logistics"],
        addons            = inputs["addons"],
        misc_total        = inputs["misc_total"],
        cr_percentage     = inputs["cr_percentage"],
        cr_cost           = inputs["cr_cost"],
        damage_percentage = inputs["damage_percentage"],
        damage_cost       = inputs["damage_cost"],
        gst               = inputs["gst_rate"],
        profit_percentage = inputs["profit_percentage"],
        breakeven         = calc['breakeven'],
        net_profit_amt    = calc['net_profit_amt'],
        bs_wo_gst         = calc['bs_wo_gst'],
        bank_settlement   = calc['bank_settlement'],
    )

    result = await session.execute(
        select(SkuPricing).where(
            SkuPricing.sku_id      == sku.id,
            SkuPricing.platform_id == platform.id,
        )
    )
    pricing = result.scalar_one_or_none()

    if pricing:
        for k, v in pricing_data.items():
            setattr(pricing, k, v)
        return pricing

    pricing = SkuPricing(**pricing_data)
    session.add(pricing)
    await session.flush()  # need pricing.id for configs
    return pricing


async def _upsert_platform_configs(
    session: AsyncSession,
    pricing: SkuPricing,
    overrides,
) -> None:
    """
    Upsert SkuPlatformConfig rows — per-platform AD%, profit%, and alias name.
    Skips overrides where nothing is set.
    """
    for override in overrides or []:
        if (override.ad_pct is None
                and override.profit_pct is None
                and not override.platform_sku_name):
            continue

        result = await session.execute(
            select(SkuPlatformConfig).where(
                SkuPlatformConfig.sku_pricing_id == pricing.id,
                SkuPlatformConfig.platform_id    == override.platform_id,
            )
        )
        cfg = result.scalar_one_or_none()

        if cfg:
            cfg.ad_pct            = override.ad_pct
            cfg.profit_pct        = override.profit_pct
            cfg.platform_sku_name = override.platform_sku_name or None
        else:
            session.add(SkuPlatformConfig(
                sku_pricing_id    = pricing.id,
                platform_id       = override.platform_id,
                ad_pct            = override.ad_pct,
                profit_pct        = override.profit_pct,
                platform_sku_name = override.platform_sku_name or None,
            ))


async def upsert_row(
    session: AsyncSession,
    row: EntryRowInput,
    misc_default: float,
    damage_default: float,
    profit_default: float,
    platforms: List[Platform],
    company_id: int,
) -> EntryRowResult:
    """
    Upsert a single entry row in 4 phases:
      1. SKU identity (Sku)                     → _upsert_sku
      2. Resolve pricing inputs + defaults      → _resolve_pricing_inputs
      3. Base pricing record (SkuPricing)       → _upsert_pricing
      4. Per-platform overrides (SkuPlatformConfig) → _upsert_platform_configs
    """
    try:
        sku = await _upsert_sku(session, row, company_id)

        pl0 = platforms[0] if platforms else None

        inputs = _resolve_pricing_inputs(row, misc_default, damage_default, profit_default, pl0)
        calc   = calculate_pricing(**inputs)

        pricing = None
        if pl0:
            pricing = await _upsert_pricing(session, sku, pl0, inputs, calc)
            await _upsert_platform_configs(session, pricing, row.platform_overrides)

        return EntryRowResult(
            shringar_sku = row.shringar_sku,
            sku_id       = sku.id,
            success      = True,
        )

    except Exception as e:
        return EntryRowResult(
            shringar_sku = row.shringar_sku,
            sku_id       = 0,
            success      = False,
            error        = str(e),
        )


async def upsert_batch(
    session: AsyncSession,
    rows: List[EntryRowInput],
    company_id: int,
) -> Tuple[List[EntryRowResult], List[EntryRowResult]]:
    """
    Upsert a batch of entry rows in a single transaction.
    Returns (saved_rows, error_rows).
    """
    misc_default   = await get_misc_total(session)
    damage_default = await get_damage_percent(session)
    profit_default = 20.0
    platforms      = await get_platforms(session)

    saved  = []
    errors = []

    for row in rows:
        result = await upsert_row(
            session        = session,
            row            = row,
            misc_default   = misc_default,
            damage_default = damage_default,
            profit_default = profit_default,
            platforms      = platforms,
            company_id     = company_id,
        )
        if result.success:
            saved.append(result)
        else:
            errors.append(result)

    return saved, errors


async def get_all_entries(session: AsyncSession, company_id: int) -> list:
    """
    Load all SKUs with their latest pricing and per-platform configs.
    Uses selectinload to eliminate N+1 queries (5 flat queries regardless of SKU count).
    """
    sku_result = await session.execute(
        select(Sku)
        .where(Sku.is_active == True, Sku.company_id == company_id)
        .options(
            selectinload(Sku.vendor),
            selectinload(Sku.category),
            selectinload(Sku.pricing).selectinload(SkuPricing.platform_configs),
        )
        .order_by(Sku.id.desc())
    )
    skus = sku_result.scalars().all()

    rows = []
    for sku in skus:
        # Pick latest pricing record without extra query
        pricing = max(sku.pricing, key=lambda p: p.id) if sku.pricing else None
        platform_configs = pricing.platform_configs if pricing else []

        vendor_name  = sku.vendor.name       if sku.vendor   else None
        vendor_short = sku.vendor.short_code if sku.vendor   else None
        category_name = sku.category.name    if sku.category else None
        # hsn_code uses lazy="joined" on the model — already loaded in main query
        hsn_code = sku.hsn_code.code         if sku.hsn_code else None
        gst_rate = sku.hsn_code.gst_rate     if sku.hsn_code else None

        rows.append({
            'id':               sku.id,
            'shringar_sku':     sku.shringar_sku,
            'series':           sku.series,
            'vendor_id':        sku.vendor_id,
            'vendor_name':      vendor_name,
            'vendor_short':     vendor_short,
            'vendor_sku':       sku.vendor_sku,
            'category_id':      sku.category_id,
            'category_name':    category_name,
            'hsn_code_id':      sku.hsn_code_id,
            'hsn_code':         hsn_code,
            'gst_rate':         gst_rate,
            'description':      sku.description,
            'price':            pricing.price             if pricing else None,
            'package':          pricing.package           if pricing else None,
            'logistics':        pricing.logistics         if pricing else None,
            'addons':           pricing.addons            if pricing else None,
            'misc_total':       pricing.misc_total        if pricing else None,
            'cr_percentage':    pricing.cr_percentage     if pricing else None,
            'cr_cost':          pricing.cr_cost           if pricing else None,
            'damage_percentage':pricing.damage_percentage if pricing else None,
            'damage_cost':      pricing.damage_cost       if pricing else None,
            'profit_percentage':pricing.profit_percentage if pricing else None,
            'gst':              pricing.gst               if pricing else None,
            'breakeven':        pricing.breakeven         if pricing else None,
            'bs_wo_gst':        pricing.bs_wo_gst         if pricing else None,
            'bank_settlement':  pricing.bank_settlement   if pricing else None,
            # Per-platform overrides
            'platform_configs': [
                {
                    'platform_id':       cfg.platform_id,
                    'ad_pct':            cfg.ad_pct,
                    'profit_pct':        cfg.profit_pct,
                    'platform_sku_name': cfg.platform_sku_name,
                }
                for cfg in platform_configs
            ],
        })

    return rows
