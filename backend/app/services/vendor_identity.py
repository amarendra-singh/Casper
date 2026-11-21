"""Resolve explicit supplier identities without guessing abbreviations."""
from fastapi import HTTPException
from sqlalchemy import select
from app.models.vendor import Vendor, VendorNameAlias


def normalize_name(name):
    return ' '.join((name or '').upper().split())


async def resolve_vendor(db, company_id, name):
    key = normalize_name(name)
    if not key:
        return None
    vendors = (await db.scalars(select(Vendor).where(Vendor.company_id == company_id))).all()
    aliases = (await db.scalars(select(VendorNameAlias).where(VendorNameAlias.company_id == company_id))).all()
    valid_ids = {v.id for v in vendors}
    matches = {v.id for v in vendors if key in (normalize_name(v.name), normalize_name(v.short_code))}
    matches.update(a.vendor_id for a in aliases if normalize_name(a.name) == key and a.vendor_id in valid_ids)
    if len(matches) > 1:
        raise HTTPException(409, 'Supplier name is ambiguous; correct the vendor names or aliases')
    return next(iter(matches), None)
