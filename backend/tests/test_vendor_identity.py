import pytest
from fastapi import HTTPException
from sqlalchemy import select
from tests.test_audit_regressions import db  # noqa: F401
from tests.test_ledger_sku_matching import parsed_bill
from app.models.vendor import Vendor, VendorNameAlias
from app.models.purchase import PurchaseBill
from app.models.ledger import LedgerEntry
from app.services.vendor_identity import resolve_vendor
from app.services.purchase import save_bills


@pytest.mark.asyncio
async def test_supplier_name_alias_is_scoped_and_reimport_reuses_identity(db):
    vendor = Vendor(company_id=1, name='JDS Enterprise', short_code='JE')
    db.add(vendor)
    await db.flush()
    db.add(VendorNameAlias(company_id=1, vendor_id=vendor.id, name='JDS'))
    await db.flush()
    for name in ('JDS', 'jds enterprise', '  JDS   ENTERPRISE ', 'je'):
        assert await resolve_vendor(db, 1, name) == vendor.id
    assert await resolve_vendor(db, 999, 'JDS') is None
    await save_bills(db, 1, None, 'JDS ENTERPRISE', [parsed_bill('alias-test')], None)
    await save_bills(db, 1, vendor.id, 'JDS ENTERPRISE', [parsed_bill('alias-test')], None)
    await save_bills(db, 1, vendor.id, 'JDS', [parsed_bill('alias-test')], None)
    bills = (await db.scalars(select(PurchaseBill))).all()
    assert len(bills) == 1
    assert bills[0].supplier_key == 'party:JDS ENTERPRISE'
    assert bills[0].vendor_id == vendor.id
    entries = (await db.scalars(select(LedgerEntry))).all()
    assert len(entries) == 1
    assert entries[0].amount == 100
    assert entries[0].vendor_id == vendor.id


@pytest.mark.asyncio
async def test_ambiguous_normalized_supplier_is_rejected(db):
    db.add_all([Vendor(company_id=1, name='Supplier', short_code='SUP1'),
                Vendor(company_id=1, name='SUPPLIER', short_code='SUP2')])
    await db.flush()
    with pytest.raises(HTTPException) as error:
        await resolve_vendor(db, 1, 'supplier')
    assert error.value.status_code == 409
