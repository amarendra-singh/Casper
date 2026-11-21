"""Shared identity resolution for missing costs and marketplace cost lookup."""
from sqlalchemy import select
from app.models.sku import Sku, SkuPricing, SkuPlatformConfig
from app.models.marketplace_alias import MarketplaceSkuAlias


def normalize_name(value):
    return (value or '').strip().upper()


async def identity_candidates(db, company_id, platform_id):
    candidates = {}
    def add(name, sku_id):
        key = normalize_name(name)
        if key:
            candidates.setdefault(key, set()).add(sku_id)
    for sku in (await db.scalars(select(Sku).where(Sku.company_id == company_id, Sku.is_active.is_(True)))).all():
        add(sku.shringar_sku, sku.id)
    for name, sku_id in (await db.execute(select(SkuPlatformConfig.platform_sku_name, SkuPricing.sku_id)
        .join(SkuPricing, SkuPricing.id == SkuPlatformConfig.sku_pricing_id)
        .where(SkuPlatformConfig.company_id == company_id, SkuPricing.company_id == company_id,
               SkuPlatformConfig.platform_id == platform_id))).all():
        add(name, sku_id)
    for alias in (await db.scalars(select(MarketplaceSkuAlias).where(
        MarketplaceSkuAlias.company_id == company_id, MarketplaceSkuAlias.platform_id == platform_id))).all():
        add(alias.name, alias.sku_id)
    return candidates


async def link_identity(db, company_id, report_id, name, sku_id):
    from app.models.pnl import PnlReport, PnlSkuRow
    from app.services.tenant_refs import validate_references
    from app.services.pnl_statement import recover_unpriced_reports, compute_unmatched_skus
    report = await db.scalar(select(PnlReport).where(PnlReport.id == report_id, PnlReport.company_id == company_id))
    if report is None:
        raise ValueError('Report not found')
    await validate_references(db, company_id, {'sku_id': sku_id})
    sku = await db.get(Sku, sku_id)
    if not sku.is_active:
        raise ValueError('Choose an active product')
    key = normalize_name(name)
    names = (await db.scalars(select(PnlSkuRow.platform_sku_name).where(
        PnlSkuRow.report_id == report_id, PnlSkuRow.company_id == company_id))).all()
    if not key or key not in {normalize_name(n) for n in names}:
        raise ValueError('Marketplace label does not exist in this report')
    candidates = await identity_candidates(db, company_id, report.platform_id)
    if candidates.get(key, set()) - {sku_id}:
        raise ValueError('This marketplace label already identifies another product; resolve its mapping first')
    alias = await db.scalar(select(MarketplaceSkuAlias).where(MarketplaceSkuAlias.company_id == company_id,
        MarketplaceSkuAlias.platform_id == report.platform_id, MarketplaceSkuAlias.name == key))
    if alias is None:
        db.add(MarketplaceSkuAlias(company_id=company_id, platform_id=report.platform_id, sku_id=sku_id, name=key))
    await db.flush()
    matched = await recover_unpriced_reports(db, company_id)
    remaining = await compute_unmatched_skus(db, company_id, report_id)
    await db.commit()
    return {'sku_id': sku_id, 'rows_matched': matched, 'remaining_hidden': len(remaining)}
