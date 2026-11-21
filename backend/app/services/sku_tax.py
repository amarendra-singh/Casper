"""One catalogue GST rate for a SKU and its saved platform calculations."""
from sqlalchemy import select
from fastapi import HTTPException

from app.models.sku import SkuPricing
from app.services.pricing import recalculate_pricing


async def set_catalogue_gst(db, sku, rate: float | None):
    pricing_rows = (await db.scalars(select(SkuPricing).where(
        SkuPricing.company_id == sku.company_id, SkuPricing.sku_id == sku.id))).all()
    if rate is None and pricing_rows:
        raise HTTPException(422, "GST cannot be blank while platform pricing exists")
    sku.gst_rate = rate
    if rate is None:
        return
    for pricing in pricing_rows:
        pricing.gst = rate
        await recalculate_pricing(db, pricing)
