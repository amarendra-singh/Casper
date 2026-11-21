"""Preview and apply derived-cost refresh without changing explicit overrides."""
import hashlib
import json
from types import SimpleNamespace
from sqlalchemy import select
from app.models.sku import SkuPricing, Sku
from app.services.pricing import recalculate_pricing


async def build_refresh_plan(db, company_id, lock=False):
    query = select(SkuPricing, Sku.shringar_sku).join(Sku, Sku.id == SkuPricing.sku_id).where(
        SkuPricing.company_id == company_id, Sku.company_id == company_id).order_by(SkuPricing.id)
    if lock:
        query = query.with_for_update()
    updates, signature = [], []
    for record, code in (await db.execute(query)).all():
        before = {column.key: getattr(record, column.key) for column in SkuPricing.__table__.columns}
        candidate = SimpleNamespace(**before)
        await recalculate_pricing(db, candidate)
        changes = {key: {'before': before[key], 'after': getattr(candidate, key)} for key in before
                   if before[key] != getattr(candidate, key)}
        signature.append({'id': record.id, 'before': before, 'changes': changes})
        if changes:
            updates.append({'id': record.id, 'sku': code, 'platform_id': record.platform_id, 'changes': changes})
    token = hashlib.sha256(json.dumps(signature, sort_keys=True, default=str).encode()).hexdigest()
    return {'token': token, 'updates': updates}


async def apply_refresh_plan(db, company_id, token):
    plan = await build_refresh_plan(db, company_id, lock=True)
    if plan['token'] != token:
        raise ValueError('Pricing or defaults changed after the preview. Preview again.')
    for update in plan['updates']:
        record = await db.get(SkuPricing, update['id'])
        for key, change in update['changes'].items():
            setattr(record, key, change['after'])
    from app.services.pnl_statement import recover_unpriced_reports
    matched = await recover_unpriced_reports(db, company_id)
    await db.commit()
    return {'updated': len(plan['updates']), 'rows_matched': matched}
