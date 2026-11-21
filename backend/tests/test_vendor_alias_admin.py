import pytest
from sqlalchemy import select
from tests.test_audit_regressions import db, client  # noqa: F401
from app.models.company import CompanyMembership, CompanyRole
from app.models.vendor import Vendor
from app.services.vendor_identity import resolve_vendor


@pytest.mark.asyncio
async def test_manage_supplier_names_scope_conflict_and_idempotence(client, db):
    vendor = Vendor(company_id=1, name='JDS Enterprise', short_code='JDS')
    other = Vendor(company_id=1, name='Another supplier', short_code='OTHER')
    db.add_all([vendor, other]); await db.commit()
    url = f'/api/v1/vendors/{vendor.id}/aliases'
    assert (await client.post(url, json={'name': 'Alternate name'})).status_code == 403
    member = await db.scalar(select(CompanyMembership).where(CompanyMembership.company_id == 1, CompanyMembership.user_id == 1))
    member.role = CompanyRole.owner; await db.commit()
    result = await client.post(url, json={'name': '  JDS  Supplies '})
    assert result.status_code == 200
    alias_id = result.json()['id']
    assert await resolve_vendor(db, 1, 'jds supplies') == vendor.id
    assert (await client.post(url, json={'name': 'JDS Supplies'})).json()['id'] == alias_id
    assert (await client.post(url, json={'name': 'OTHER'})).status_code == 409
    assert (await client.post('/api/v1/vendors/2/aliases', json={'name': 'Foreign'})).status_code == 404
    assert (await client.delete(url + f'/{alias_id}')).status_code == 200
    assert await resolve_vendor(db, 1, 'JDS Supplies') is None
