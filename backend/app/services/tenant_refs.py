"""Validate referenced records before attaching them to a company-owned record."""

from sqlalchemy import select
from app.models.sku import Sku
from app.models.platform import Platform
from app.models.vendor import Vendor
from app.models.category import Category
from app.models.hsn_code import HsnCode


async def validate_references(db, company_id: int, values: dict) -> None:
    models = {
        "sku_id": Sku,
        "platform_id": Platform,
        "vendor_id": Vendor,
        "category_id": Category,
        "hsn_code_id": HsnCode,
    }
    for field, model in models.items():
        value = values.get(field)
        if value is not None:
            query = select(model.id).where(model.id == value)
            if hasattr(model, "company_id"):
                query = query.where(model.company_id == company_id)
            found = await db.scalar(query)
            if found is None:
                raise ValueError(f"Invalid {field} for this company")
