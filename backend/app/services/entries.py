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
from app.services.scope import company_ids
from app.models.sku import Sku, SkuPricing, SkuPlatformConfig, SkuReverseShipping
from app.models.platform import Platform
from app.models.global_settings import GlobalSettings
from app.models.misc_item import MiscItem


# These three feed every breakeven. `company_id` is REQUIRED, not optional with
# a default — unscoped, they returned another tenant's rows and silently built
# one company's cost model out of another's platform, misc charge and settings.
async def get_misc_total(session: AsyncSession, company_id: int) -> float:
    """Sum this company's active misc items."""
    result = await session.execute(
        select(MiscItem).where(
            MiscItem.is_active == True,
            MiscItem.company_id == company_id,
        )
    )
    return sum(item.amount for item in result.scalars().all())


async def get_damage_percent(session: AsyncSession, company_id: int) -> float:
    result = await session.execute(
        select(GlobalSettings).where(
            GlobalSettings.key == 'damage_percent',
            GlobalSettings.company_id == company_id,
        )
    )
    setting = result.scalar_one_or_none()
    return float(setting.value) if setting else 15.0


async def get_platforms(session: AsyncSession, company_id: int) -> List[Platform]:
    """
    This company's active platforms, oldest first.

    The order matters: upsert_batch anchors every breakeven on platforms[0].
    Without an explicit ORDER BY that anchor was whatever row SQLite handed
    back first, so a company's whole cost model could silently re-anchor.
    """
    result = await session.execute(
        select(Platform).where(
            Platform.is_active == True,
            Platform.company_id == company_id,
        ).order_by(Platform.id)
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
    from app.services.pricing import calculate_pricing as calculate
    result = calculate(price, package, logistics, addons, misc_total, cr_cost,
                       damage_cost, gst_rate, profit_percentage)
    return {**result, 'net_profit_pct': round(profit_percentage, 2)}



async def _upsert_sku(session: AsyncSession, row: EntryRowInput, company_id: int) -> Sku:
    """Create or update the base Sku record (identity + metadata, no pricing)."""
    result = await session.execute(
        select(Sku).where(Sku.company_id == company_id,
                          Sku.id == row.sku_id if row.sku_id else Sku.shringar_sku == row.shringar_sku)
    )
    sku = result.scalar_one_or_none()

    if row.sku_id and sku is None:
        raise ValueError("SKU not found in this company")
    if sku:
        sku.shringar_sku = row.shringar_sku
        # Partial update — only overwrite fields the client explicitly provided
        for field in ("vendor_id", "category_id", "hsn_code_id",
                      "description", "vendor_sku", "series"):
            val = getattr(row, field)
            if field in row.model_fields_set:
                setattr(sku, field, val)
        if row.gst is not None:
            sku.gst_rate = row.gst
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
        gst_rate     = row.gst,
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
    reverse_shipping_charge: float | None = None,
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

    from app.services.pricing import resolve_cost_allowances
    charge = (reverse_shipping_charge if reverse_shipping_charge is not None
              else pl0.cr_charge if pl0 else 0)
    allowances = resolve_cost_allowances(row.price, charge,
        cr_pct, row.cr_cost, dmg_pct, row.damage_cost)
    cr_pct, cr_cost = allowances['cr_percentage'], allowances['cr_cost']
    dmg_pct, damage_cost = allowances['damage_percentage'], allowances['damage_cost']

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
        gst_rate          = row.gst,
    )


async def _upsert_pricing(
    session: AsyncSession,
    sku: Sku,
    platform: Platform,
    inputs: dict,
    calc: dict,
    row: EntryRowInput,
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
        cr_cost_override=row.cr_cost,
        damage_cost_override=row.damage_cost,
        misc_total_override=row.misc_total,
    )

    result = await session.execute(
        select(SkuPricing).where(
            SkuPricing.company_id  == sku.company_id,
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
    Upsert SkuPlatformConfig rows — per-platform pricing and alias overrides.
    Skips overrides where nothing is set.
    """
    for override in overrides or []:
        if "reverse_shipping_charge" in override.model_fields_set:
            from app.services.pricing import set_reverse_shipping_override
            await set_reverse_shipping_override(session, pricing.sku_id, override.platform_id,
                                                pricing.company_id, override.reverse_shipping_charge)
        result = await session.execute(
            select(SkuPlatformConfig).where(
                SkuPlatformConfig.sku_pricing_id == pricing.id,
                SkuPlatformConfig.platform_id    == override.platform_id,
            )
        )
        cfg = result.scalar_one_or_none()

        if (override.ad_pct is None and override.profit_pct is None
                and override.reverse_shipping_charge is None and not override.platform_sku_name):
            if cfg:
                await session.delete(cfg)
            continue
        if cfg:
            cfg.ad_pct            = override.ad_pct
            cfg.profit_pct        = override.profit_pct
            cfg.reverse_shipping_charge = override.reverse_shipping_charge
            cfg.platform_sku_name = override.platform_sku_name or None
        else:
            session.add(SkuPlatformConfig(
                company_id        = pricing.company_id,
                sku_pricing_id    = pricing.id,
                platform_id       = override.platform_id,
                ad_pct            = override.ad_pct,
                profit_pct        = override.profit_pct,
                reverse_shipping_charge = override.reverse_shipping_charge,
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
        async with session.begin_nested():
            from app.services.tenant_refs import validate_references
            await validate_references(session, company_id, row.model_dump(exclude={'sku_id'}))
            for override in row.platform_overrides:
                await validate_references(session, company_id, {'platform_id': override.platform_id})
            sku = await _upsert_sku(session, row, company_id)
            if row.gst is None:
                saved_gst = await session.scalar(select(SkuPricing.gst).where(
                    SkuPricing.company_id == company_id, SkuPricing.sku_id == sku.id)
                    .order_by(SkuPricing.platform_id, SkuPricing.id).limit(1))
                rate = sku.gst_rate if sku.gst_rate is not None else (
                    sku.hsn_code.gst_rate if sku.hsn_code else saved_gst)
                # Existing API callers can still save an unconfigured SKU. Keep
                # Catalogue GST unset so the grid does not present zero as a
                # verified tax rate; its legacy pricing calculation uses zero.
                row = row.model_copy(update={"gst": 0 if rate is None else rate})

            # Read and write the same canonical base, including after a
            # platform is deactivated. Dedicated Pricing remains per-platform.
            base_platform_id = await session.scalar(select(SkuPricing.platform_id).where(
                SkuPricing.company_id == company_id, SkuPricing.sku_id == sku.id
            ).order_by(SkuPricing.platform_id, SkuPricing.id).limit(1))
            pl0 = await session.scalar(select(Platform).where(
                Platform.id == base_platform_id, Platform.company_id == company_id
            )) if base_platform_id else (platforms[0] if platforms else None)
            if pl0 is None:
                if base_platform_id:
                    raise ValueError("Stored pricing references a foreign platform. Review its company mapping before editing.")
                raise ValueError("Activate a platform before saving SKU pricing")

            base_config = next((o for o in row.platform_overrides if o.platform_id == pl0.id), None)
            if base_config is not None and "reverse_shipping_charge" in base_config.model_fields_set:
                charge_override = base_config.reverse_shipping_charge
            else:
                from app.services.pricing import get_reverse_shipping_override
                charge_override = await get_reverse_shipping_override(session, sku.id, pl0.id, company_id)
            inputs = _resolve_pricing_inputs(
                row, misc_default, damage_default, profit_default, pl0, charge_override)
            calc   = calculate_pricing(**inputs)

            pricing = None
            if pl0:
                pricing = await _upsert_pricing(session, sku, pl0, inputs, calc, row)
                await _upsert_platform_configs(session, pricing, row.platform_overrides)
                if sku.gst_rate is not None:
                    from app.services.sku_tax import set_catalogue_gst
                    await set_catalogue_gst(session, sku, row.gst)

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
    misc_default   = await get_misc_total(session, company_id)
    damage_default = await get_damage_percent(session, company_id)
    profit_default = 20.0
    platforms      = await get_platforms(session, company_id)

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

    if saved:
        from app.services.pnl_statement import recover_unpriced_reports
        await recover_unpriced_reports(session, company_id)
    await session.commit()
    return saved, errors


async def get_all_entries(session: AsyncSession, company_id: int | list[int],
                          include_inactive: bool = False) -> list:
    """
    Load all SKUs with their canonical base pricing and per-platform configs.
    Uses selectinload to eliminate N+1 queries (a fixed number of queries regardless of SKU count).
    """
    _cids = company_ids(company_id)
    sku_query = select(Sku).where(Sku.company_id.in_(_cids))
    if not include_inactive:
        sku_query = sku_query.where(Sku.is_active.is_(True))
    sku_result = await session.execute(
        sku_query
        .options(
            selectinload(Sku.vendor),
            selectinload(Sku.category),
            selectinload(Sku.pricing).selectinload(SkuPricing.platform_configs),
            selectinload(Sku.pricing).selectinload(SkuPricing.platform),
        )
        .order_by(Sku.id.desc())
    )
    skus = sku_result.scalars().all()
    shipping = {(record.sku_id, record.platform_id): record.charge for record in
        (await session.scalars(select(SkuReverseShipping).where(
            SkuReverseShipping.company_id.in_(_cids)))).all()}

    # Company name/colour, so a consolidated list can show which company owns each
    # row. Only looked up when the scope spans more than one company.
    co_meta: dict[int, tuple] = {}
    if len(_cids) > 1:
        from app.models.company import Company
        co_rows = await session.execute(
            select(Company.id, Company.name, Company.color).where(Company.id.in_(_cids))
        )
        co_meta = {cid: (name, color) for cid, name, color in co_rows.all()}

    rows = []
    for sku in skus:
        co_name, co_color = co_meta.get(sku.company_id, (None, None))
        # Canonical base: lowest platform ID, then pricing ID
        pricing = min(sku.pricing, key=lambda p: (p.platform_id, p.id)) if sku.pricing else None
        platform_configs = pricing.platform_configs if pricing else []
        configs_by_platform = {cfg.platform_id: cfg for cfg in platform_configs}
        platform_ids = set(configs_by_platform) | {
            platform_id for sku_id, platform_id in shipping if sku_id == sku.id}

        vendor_name  = sku.vendor.name       if sku.vendor   else None
        vendor_short = sku.vendor.short_code if sku.vendor   else None
        category_name = sku.category.name    if sku.category else None
        # hsn_code uses lazy="joined" on the model — already loaded in main query
        hsn_code = sku.hsn_code.code         if sku.hsn_code else None
        gst_rate = sku.gst_rate if sku.gst_rate is not None else (
            sku.hsn_code.gst_rate if sku.hsn_code else None)

        rows.append({
            'id':               sku.id,
            'shringar_sku':     sku.shringar_sku,
            'is_active':        sku.is_active,
            'company_id':       sku.company_id,
            'company_name':     co_name,
            'company_color':    co_color,
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
            'base_reference_valid': bool(not pricing or pricing.platform),
            'base_platform_id': pricing.platform_id if pricing else None,
            'base_cr_charge': pricing.platform.cr_charge if pricing and pricing.platform else None,
            'cr_cost_override': pricing.cr_cost_override if pricing else None,
            'damage_cost_override': pricing.damage_cost_override if pricing else None,
            'misc_total_override': pricing.misc_total_override if pricing else None,
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
            'gst':              gst_rate,
            'breakeven':        pricing.breakeven         if pricing else None,
            'bs_wo_gst':        pricing.bs_wo_gst         if pricing else None,
            'bank_settlement':  pricing.bank_settlement   if pricing else None,
            # Per-platform overrides
            'platform_configs': [
                {
                    'platform_id':       platform_id,
                    'ad_pct':            configs_by_platform[platform_id].ad_pct if platform_id in configs_by_platform else None,
                    'profit_pct':        configs_by_platform[platform_id].profit_pct if platform_id in configs_by_platform else None,
                    'reverse_shipping_charge': shipping.get((sku.id, platform_id)),
                    'platform_sku_name': configs_by_platform[platform_id].platform_sku_name if platform_id in configs_by_platform else None,
                }
                for platform_id in sorted(platform_ids)
            ],
        })

    return rows
