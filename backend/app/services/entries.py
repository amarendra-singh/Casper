"""
Entry upsert service.
Handles create-or-update of SKU + Pricing in a single transaction.
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Tuple

from app.schemas.entries import EntryRowInput, EntryRowResult
from app.models.sku import Sku, SkuPricing
from app.models.platform import Platform
from app.models.global_settings import GlobalSettings
from app.models.misc_item import MiscItem
from app.schemas.entries import EntryRowInput, EntryRowResult


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
    """Get all active platforms with tiers."""
    result = await session.execute(
        select(Platform).where(Platform.is_active == True)
    )
    return result.scalars().all()


def calculate_pricing(
    price: float,
    package: float,
    logistics: float,
    ad: float,
    addons: float,
    misc_total: float,
    cr_percentage: float,
    cr_cost: float,
    damage_percentage: float,
    damage_cost: float,
    profit_percentage: float,
    gst: float,
) -> dict:
    """
    Core pricing formula — mirrors the existing pricing service.
    Returns all calculated fields.
    """
    breakeven = price + package + logistics + ad + addons + misc_total + cr_cost + damage_cost
    net_profit = breakeven * (profit_percentage / 100)
    bs_wo_gst  = round(breakeven + net_profit)
    bank_settlement = bs_wo_gst + gst

    return {
        'breakeven':        round(breakeven, 2),
        'net_profit_pct':   round(profit_percentage, 2),
        'net_profit_amt':   round(net_profit, 2),
        'bs_wo_gst':        bs_wo_gst,
        'bank_settlement':  bank_settlement,
    }


async def upsert_row(
    session: AsyncSession,
    row: EntryRowInput,
    misc_default: float,
    damage_default: float,
    profit_default: float,
    platforms: List[Platform],
) -> EntryRowResult:
    """
    Upsert a single entry row.
    Creates or updates SKU record.
    Returns result with success/error.
    """
    try:
        # ── 1. Upsert SKU ──────────────────────────────────────────────────
        result = await session.execute(
            select(Sku).where(Sku.shringar_sku == row.shringar_sku)
        )
        sku = result.scalar_one_or_none()

        if sku:
            # Update existing SKU
            if row.vendor_id   is not None: sku.vendor_id   = row.vendor_id
            if row.category_id is not None: sku.category_id = row.category_id
            if row.hsn_code_id is not None: sku.hsn_code_id = row.hsn_code_id
            if row.description is not None: sku.description = row.description
        else:
            # Create new SKU
            sku = Sku(
                shringar_sku = row.shringar_sku,
                vendor_id    = row.vendor_id,
                category_id  = row.category_id,
                hsn_code_id  = row.hsn_code_id,
                description  = row.description,
                is_active    = True,
            )
            session.add(sku)
            await session.flush()  # get sku.id without committing

        # ── 2. Resolve inputs ──────────────────────────────────────────────
        misc_total  = row.misc_total if row.misc_total is not None else misc_default
        dmg_pct     = row.damage_percentage if row.damage_percentage is not None else damage_default
        profit_pct  = row.profit_percentage if row.profit_percentage is not None else profit_default

        # CR — use first platform as default reference
        pl0 = platforms[0] if platforms else None
        cr_pct = row.cr_percentage if row.cr_percentage is not None else (
            pl0.cr_percentage if pl0 else 10.0
        )

        # Bidirectional: if cr_cost given, back-calculate cr_pct
        if row.cr_cost is not None:
            cr_cost = row.cr_cost
            cr_pct  = (cr_cost / pl0.cr_charge * 100) if pl0 and pl0.cr_charge else cr_pct
        else:
            cr_cost = (pl0.cr_charge * cr_pct / 100) if pl0 else 0

        # Bidirectional: if damage_cost given, back-calculate damage_pct
        if row.damage_cost is not None:
            damage_cost = row.damage_cost
            dmg_pct     = (damage_cost / row.price * 100) if row.price else dmg_pct
        else:
            damage_cost = row.price * dmg_pct / 100

        gst = row.gst or 0

        # ── 3. Calculate pricing ───────────────────────────────────────────
        calc = calculate_pricing(
            price             = row.price,
            package           = row.package or 0,
            logistics         = row.logistics or 0,
            ad                = row.ad or 0,
            addons            = row.addons or 0,
            misc_total        = misc_total,
            cr_percentage     = cr_pct,
            cr_cost           = cr_cost,
            damage_percentage = dmg_pct,
            damage_cost       = damage_cost,
            profit_percentage = profit_pct,
            gst               = gst,
        )

        # ── 4. Upsert pricing record ───────────────────────────────────────
        # Use first active platform for the main pricing record
        if pl0:
            pricing_result = await session.execute(
                select(SkuPricing).where(
                    SkuPricing.sku_id      == sku.id,
                    SkuPricing.platform_id == pl0.id,
                )
            )
            pricing = pricing_result.scalar_one_or_none()

            pricing_data = dict(
                sku_id            = sku.id,
                platform_id       = pl0.id,
                price             = row.price,
                package           = row.package or 0,
                logistics         = row.logistics or 0,
                addons            = row.addons or 0,
                misc_total        = misc_total,
                cr_percentage     = cr_pct,
                cr_cost           = cr_cost,
                damage_percentage = dmg_pct,
                damage_cost       = damage_cost,
                gst               = gst,
                breakeven         = calc['breakeven'],
                net_profit_20     = calc['net_profit_amt'],
                bs_wo_gst         = calc['bs_wo_gst'],
                bank_settlement   = calc['bank_settlement'],
                is_active         = True,
            )

            if pricing:
                for k, v in pricing_data.items():
                    setattr(pricing, k, v)
            else:
                session.add(SkuPricing(**pricing_data))

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
) -> Tuple[List[EntryRowResult], List[EntryRowResult]]:
    """
    Upsert a batch of entry rows in a single transaction.
    Returns (saved_rows, error_rows).
    
    Key design: errors on individual rows don't rollback the whole batch.
    Each row is attempted independently.
    """
    # Load shared data once (not per row)
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
        )
        if result.success:
            saved.append(result)
        else:
            errors.append(result)

    return saved, errors

async def get_all_entries(session: AsyncSession) -> list:
    """
    Load all SKUs with their latest pricing.
    Returns data shaped for the Entries page.
    """
    from app.models.vendor import Vendor
    from app.models.category import Category
    from app.models.hsn_code import HsnCode

    # Load all active SKUs
    sku_result = await session.execute(
        select(Sku)
        .where(Sku.is_active == True)
        .order_by(Sku.id.desc())
    )
    skus = sku_result.scalars().all()

    rows = []
    for sku in skus:
        # Get latest pricing for this SKU
        pricing_result = await session.execute(
            select(SkuPricing)
            .where(SkuPricing.sku_id == sku.id)
            .order_by(SkuPricing.id.desc())
            .limit(1)
        )
        pricing = pricing_result.scalar_one_or_none()

        # Get vendor info
        vendor_name  = None
        vendor_short = None
        if sku.vendor_id:
            v_result = await session.execute(
                select(Vendor).where(Vendor.id == sku.vendor_id)
            )
            vendor = v_result.scalar_one_or_none()
            if vendor:
                vendor_name  = vendor.name
                vendor_short = vendor.short_code

        # Get category info
        category_name = None
        if sku.category_id:
            c_result = await session.execute(
                select(Category).where(Category.id == sku.category_id)
            )
            category = c_result.scalar_one_or_none()
            if category:
                category_name = category.name

        # Get HSN info
        hsn_code = None
        gst_rate = None
        if sku.hsn_code_id:
            h_result = await session.execute(
                select(HsnCode).where(HsnCode.id == sku.hsn_code_id)
            )
            hsn = h_result.scalar_one_or_none()
            if hsn:
                hsn_code = hsn.code
                gst_rate = hsn.gst_rate

        rows.append({
            'id':               sku.id,
            'shringar_sku':     sku.shringar_sku,
            'vendor_id':        sku.vendor_id,
            'vendor_name':      vendor_name,
            'vendor_short':     vendor_short,
            'category_id':      sku.category_id,
            'category_name':    category_name,
            'hsn_code_id':      sku.hsn_code_id,
            'hsn_code':         hsn_code,
            'gst_rate':         gst_rate,
            'description':      sku.description,
            'price':            pricing.price        if pricing else None,
            'package':          pricing.package      if pricing else None,
            'logistics':        pricing.logistics    if pricing else None,
            'ad':               None,
            'addons':           pricing.addons       if pricing else None,
            'misc_total':       pricing.misc_total   if pricing else None,
            'cr_percentage':    pricing.cr_percentage   if pricing else None,
            'cr_cost':          pricing.cr_cost         if pricing else None,
            'damage_percentage':pricing.damage_percentage if pricing else None,
            'damage_cost':      pricing.damage_cost      if pricing else None,
            'profit_percentage':None,
            'gst':              pricing.gst          if pricing else None,
            'breakeven':        pricing.breakeven    if pricing else None,
            'bs_wo_gst':        pricing.bs_wo_gst    if pricing else None,
            'bank_settlement':  pricing.bank_settlement if pricing else None,
        })

    return rows