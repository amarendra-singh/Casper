"""Catalogue contracts on synthetic, foreign-key-enforced company data."""
from datetime import date
from io import BytesIO
import json
from uuid import uuid4

import pytest
from PIL import Image
from sqlalchemy import select

from app.models.company import CompanyMembership, CompanyRole
from app.models.sku import Sku, SkuPricing, SkuReverseShipping
from app.models.catalogue import StockCost, StockMovement
from app.models.vendor import Vendor
from app.models.category import Category
from app.models.platform import Platform
from app.models.purchase import PurchaseBill, PurchaseBillLine
from app.models.pnl import PnlReport, PnlSkuRow
from app.core.config import settings
from .test_audit_regressions import client, db  # shared disposable app/session fixtures

ROOT = "/api/v1/catalogue"
TODAY = date.today().isoformat()


async def owner(db):
    member = await db.scalar(select(CompanyMembership).where(
        CompanyMembership.company_id == 1, CompanyMembership.user_id == 1))
    member.role = CompanyRole.owner
    await db.commit()


@pytest.mark.asyncio
async def test_bulk_catalogue_creates_only_product_identities_and_rejects_partial_files(client, db):
    await owner(db)
    db.add(Vendor(company_id=1, name="Glass Supplier", short_code="GS"))
    db.add(Category(company_id=1, name="Glassware"))
    await db.commit()
    rows = [
        {"shringar_sku": "GLASS-P1", "display_name": "Glass single", "vendor_sku": "G-1",
         "vendor": "Glass Supplier", "category": "Glassware", "description": "Single piece"},
        {"shringar_sku": "GLASS-P4", "display_name": "Glass four pack"},
    ]
    created = await client.post(f"{ROOT}/bulk-products", json={"rows": rows})
    assert created.status_code == 201, created.text
    assert created.json()["created"] == 2
    first = await db.scalar(select(Sku).where(Sku.shringar_sku == "GLASS-P1"))
    assert first.display_name == "Glass single" and first.vendor_sku == "G-1"
    assert first.vendor_id is not None and first.category_id is not None
    assert first.stock_item_id is None
    assert not (await db.scalars(select(SkuPricing).where(SkuPricing.sku_id == first.id))).all()
    duplicate = await client.post(f"{ROOT}/bulk-products", json={"rows": [
        {"shringar_sku": "NEW-P1"}, {"shringar_sku": "GLASS-P4"}]})
    assert duplicate.status_code == 409
    assert await db.scalar(select(Sku.id).where(Sku.shringar_sku == "NEW-P1")) is None
    unknown = await client.post(f"{ROOT}/bulk-products", json={"rows": [
        {"shringar_sku": "NEW-P1"}, {"shringar_sku": "NEW-P2", "vendor": "Other company's vendor"}]})
    assert unknown.status_code == 422
    assert await db.scalar(select(Sku.id).where(Sku.shringar_sku == "NEW-P1")) is None


@pytest.mark.asyncio
async def test_catalogue_add_and_edit_stays_on_product_profile(client, db):
    await owner(db)
    added = await client.post("/api/v1/skus/", json={
        "shringar_sku": "PROFILE-P1", "display_name": "Profile product", "vendor_sku": "VP-1"})
    assert added.status_code == 201, added.text
    sku_id = added.json()["id"]
    edited = await client.patch(f"{ROOT}/{sku_id}", json={
        "display_name": "Updated product", "vendor_sku": "VP-2", "description": "Edited here", "is_active": False})
    assert edited.status_code == 200, edited.text
    profile = await client.get(f"{ROOT}/{sku_id}")
    assert profile.status_code == 200
    assert {key: profile.json()[key] for key in ("name", "vendor_sku", "is_active", "description")} == {
        "name": "Updated product", "vendor_sku": "VP-2", "is_active": False, "description": "Edited here"}


@pytest.mark.asyncio
async def test_catalogue_gst_without_price_flows_to_unit_economics_and_reloads(client, db):
    await owner(db)
    created = await client.post(f"{ROOT}/bulk-apply", data={"payload": json.dumps({"rows": [{
        "operation": "create", "shringar_sku": "TAX-P1", "is_active": False,
        "gst": 18,
    }]})})
    assert created.status_code == 200, created.text
    sku = await db.scalar(select(Sku).where(Sku.shringar_sku == "TAX-P1"))
    assert sku.gst_rate == 18
    assert await db.scalar(select(SkuPricing.id).where(SkuPricing.sku_id == sku.id)) is None
    profile = await client.get(f"{ROOT}/{sku.id}")
    assert profile.json()["gst_rate"] == 18
    entries = await client.get("/api/v1/entries/", params={"include_inactive": "true"})
    assert entries.status_code == 200, entries.text
    row = next(row for row in entries.json() if row["id"] == sku.id)
    assert row["gst"] == row["gst_rate"] == 18
    assert row["price"] is None
    changed = await client.patch(f"{ROOT}/{sku.id}", json={"gst_rate": 5})
    assert changed.status_code == 200, changed.text
    assert (await client.get(f"{ROOT}/{sku.id}")).json()["gst_rate"] == 5
    reloaded = (await client.get("/api/v1/entries/", params={"include_inactive": "true"})).json()
    assert next(row for row in reloaded if row["id"] == sku.id)["gst"] == 5


@pytest.mark.asyncio
async def test_bulk_actions_apply_identity_price_cost_stock_image_and_deactivate(client, db, monkeypatch, tmp_path):
    await owner(db)
    monkeypatch.setattr(settings, "PRODUCT_MEDIA_DIR", str(tmp_path))
    image = Image.new("RGB", (24, 24), "blue")
    buf = BytesIO(); image.save(buf, format="PNG")
    rows = [{"operation": "create", "shringar_sku": "GLASS-P4", "display_name": "Four glasses",
        "stock_item": "Blue glass", "base_units_per_sku": 4, "on_hand_base_units": 20,
        "stock_date": TODAY, "stock_reason": "Count from catalogue sheet",
        "cost_per_base_unit": 67.5, "cost_effective_date": TODAY,
        "cost_note": "Supplier rate from catalogue sheet", "platform": "Flipkart",
        "price": 270, "package": 10, "profit_percentage": 25, "gst": 18,
        "image_url": "https://example.com/glass.png", "image_file": "glass.png"}]
    response = await client.post(f"{ROOT}/bulk-apply", data={"payload": json.dumps({"rows": rows})},
        files=[("files", ("glass.png", buf.getvalue(), "image/png"))])
    assert response.status_code == 200, response.text
    assert response.json() == {"created": 1, "updated": 0, "deactivated": 0,
        "images": 1, "prices": 1, "costs": 1, "stock": 1}
    sku = await db.scalar(select(Sku).where(Sku.shringar_sku == "GLASS-P4"))
    profile = (await client.get(f"{ROOT}/{sku.id}")).json()
    assert profile["primary_image_url"] == "https://example.com/glass.png"
    assert profile["primary_image_id"] is not None
    assert profile["purchase_cost"] == 270
    assert profile["on_hand_base_units"] == 20
    assert len(list(tmp_path.glob("*.webp"))) == 2
    price = await db.scalar(select(SkuPricing).where(SkuPricing.sku_id == sku.id))
    assert price.price == 270 and price.package == 10 and price.profit_percentage == 25
    assert await db.scalar(select(StockCost.id).where(StockCost.stock_item_id == sku.stock_item_id))

    update = await client.post(f"{ROOT}/bulk-apply", data={"payload": json.dumps({"rows": [{
        "operation": "update", "shringar_sku": "GLASS-P4", "on_hand_base_units": 12,
        "stock_date": TODAY, "stock_reason": "New counted balance", "platform": "Flipkart", "price": 280,
    }]})})
    assert update.status_code == 200, update.text
    assert update.json()["stock"] == 1
    assert (await client.get(f"{ROOT}/{sku.id}")).json()["on_hand_base_units"] == 12
    assert (await db.scalar(select(SkuPricing).where(SkuPricing.sku_id == sku.id))).price == 280
    del_result = await client.post(f"{ROOT}/bulk-apply", data={"payload": json.dumps({"rows": [
        {"operation": "delete", "shringar_sku": "GLASS-P4"}]})})
    assert del_result.status_code == 200
    await db.refresh(sku)
    assert sku.is_active is False
    assert await db.scalar(select(StockMovement.id).where(StockMovement.stock_item_id == sku.stock_item_id))


@pytest.mark.asyncio
async def test_bulk_actions_roll_back_all_rows_and_image_files_on_late_error(client, db, monkeypatch, tmp_path):
    await owner(db)
    monkeypatch.setattr(settings, "PRODUCT_MEDIA_DIR", str(tmp_path))
    image = Image.new("RGB", (24, 24), "red")
    buf = BytesIO(); image.save(buf, format="PNG")
    rows = [{"operation": "create", "shringar_sku": "FIRST-P1", "image_file": "first.png"},
            {"operation": "update", "shringar_sku": "MISSING-P1"}]
    response = await client.post(f"{ROOT}/bulk-apply", data={"payload": json.dumps({"rows": rows})},
        files=[("files", ("first.png", buf.getvalue(), "image/png"))])
    assert response.status_code == 404
    assert await db.scalar(select(Sku.id).where(Sku.shringar_sku == "FIRST-P1")) is None
    assert not list(tmp_path.glob("*.webp"))


@pytest.mark.asyncio
async def test_bulk_actions_reject_foreign_sku_and_conflicting_shared_stock(client, db):
    await owner(db)
    foreign = await client.post(f"{ROOT}/bulk-apply", data={"payload": json.dumps({"rows": [
        {"operation": "update", "shringar_sku": "FOREIGN-SKU", "display_name": "Wrong tenant"}]})})
    assert foreign.status_code == 404
    first = {"operation": "create", "shringar_sku": "SHARED-P1", "stock_item": "Shared glass",
        "base_units_per_sku": 1, "on_hand_base_units": 10, "stock_date": TODAY,
        "stock_reason": "Count one"}
    second = {"operation": "create", "shringar_sku": "SHARED-P4", "stock_item": "Shared glass",
        "base_units_per_sku": 4, "on_hand_base_units": 12, "stock_date": TODAY,
        "stock_reason": "Count two"}
    conflict = await client.post(f"{ROOT}/bulk-apply", data={"payload": json.dumps({"rows": [first, second]})})
    assert conflict.status_code == 422
    assert await db.scalar(select(Sku.id).where(Sku.shringar_sku == "SHARED-P1")) is None


@pytest.mark.asyncio
async def test_bulk_actions_support_two_platforms_for_one_created_sku(client, db):
    await owner(db)
    db.add(Platform(company_id=1, name="Meesho", cr_charge=0, cr_percentage=0))
    await db.commit()
    rows = [{"operation": "create", "shringar_sku": "DUAL-P1", "platform": "Flipkart",
             "price": 50, "gst": 18, "cr_percentage": 10, "reverse_shipping_charge": 40},
            {"operation": "update", "shringar_sku": "DUAL-P1", "platform": "Meesho",
             "price": 55, "cr_percentage": 10, "reverse_shipping_charge": 0}]
    response = await client.post(f"{ROOT}/bulk-apply", data={"payload": json.dumps({"rows": rows})})
    assert response.status_code == 200, response.text
    assert response.json()["prices"] == 2
    sku = await db.scalar(select(Sku).where(Sku.shringar_sku == "DUAL-P1"))
    prices = (await db.scalars(select(SkuPricing).where(SkuPricing.sku_id == sku.id))).all()
    assert sorted(p.price for p in prices) == [50, 55]
    assert sorted(p.cr_cost for p in prices) == [0, 4]
    tax_edit = await client.patch(f"{ROOT}/{sku.id}", json={"gst_rate": 5})
    assert tax_edit.status_code == 200, tax_edit.text
    sku_id = sku.id
    db.expire_all()
    prices = (await db.scalars(select(SkuPricing).where(SkuPricing.sku_id == sku_id))).all()
    assert {p.gst for p in prices} == {5}
    assert (await client.get(f"{ROOT}/{sku_id}")).json()["gst_rate"] == 5
    charges = (await db.scalars(select(SkuReverseShipping).where(SkuReverseShipping.company_id == 1))).all()
    assert sorted(c.charge for c in charges) == [0, 40]


@pytest.mark.asyncio
async def test_bulk_reverse_shipping_needs_no_second_platform_price(client, db):
    await owner(db)
    db.add(Platform(company_id=1, name="Meesho", cr_charge=80, cr_percentage=10))
    await db.commit()
    rows = [{"operation": "create", "shringar_sku": "ONE-PRICE", "platform": "Flipkart", "price": 50, "gst": 18},
            {"operation": "update", "shringar_sku": "ONE-PRICE", "platform": "Meesho",
             "reverse_shipping_charge": 25}]
    response = await client.post(f"{ROOT}/bulk-apply", data={"payload": json.dumps({"rows": rows})})
    assert response.status_code == 200, response.text
    sku = await db.scalar(select(Sku).where(Sku.shringar_sku == "ONE-PRICE"))
    prices = (await db.scalars(select(SkuPricing).where(SkuPricing.sku_id == sku.id))).all()
    assert len(prices) == 1
    charge = await db.scalar(select(SkuReverseShipping).where(
        SkuReverseShipping.sku_id == sku.id, SkuReverseShipping.platform_id != prices[0].platform_id))
    assert charge.charge == 25


@pytest.mark.asyncio
async def test_catalogue_reverse_shipping_before_pricing_and_after_details(client, db):
    await owner(db)
    platform = await db.scalar(select(Platform).where(Platform.company_id == 1))
    platform.cr_charge = 90
    await db.commit()
    created = await client.post("/api/v1/skus/", json={
        "shringar_sku": "NEW-RETURN-P1", "display_name": "New product",
        "reverse_shipping_platform_id": platform.id, "reverse_shipping_charge": 0})
    assert created.status_code == 201, created.text
    sku_id = created.json()["id"]
    assert not await db.scalar(select(SkuPricing.id).where(SkuPricing.sku_id == sku_id))
    profile = (await client.get(f"{ROOT}/{sku_id}")).json()
    current = next(row for row in profile["reverse_shipping"] if row["platform_id"] == platform.id)
    assert current["override"] == 0 and current["platform_charge"] == 90

    updated = await client.put(f"{ROOT}/{sku_id}/reverse-shipping", json={
        "platform_id": platform.id, "charge": 25})
    assert updated.status_code == 200, updated.text
    assert (await db.scalar(select(SkuReverseShipping).where(
        SkuReverseShipping.sku_id == sku_id))).charge == 25
    cleared = await client.put(f"{ROOT}/{sku_id}/reverse-shipping", json={
        "platform_id": platform.id, "charge": None})
    assert cleared.status_code == 200
    assert cleared.json()["effective_charge"] == 90
    assert await db.scalar(select(SkuReverseShipping.id).where(
        SkuReverseShipping.sku_id == sku_id)) is None
    assert (await client.put(f"{ROOT}/{sku_id}/reverse-shipping", json={
        "platform_id": platform.id, "charge": -1})).status_code == 422


@pytest.mark.asyncio
async def test_catalogue_reverse_shipping_recalculates_existing_price(client, db):
    await owner(db)
    platform = await db.get(Platform, 1)
    platform.cr_charge = 90
    pricing = await db.get(SkuPricing, 1)
    pricing.cr_percentage = 10
    await db.commit()
    changed = await client.put(f"{ROOT}/1/reverse-shipping", json={
        "platform_id": 1, "charge": 25})
    assert changed.status_code == 200, changed.text
    await db.refresh(pricing)
    assert pricing.cr_cost == 2.5
    profile = (await client.get(f"{ROOT}/1")).json()
    assert profile["pricing"][0]["reverse_shipping_charge"] == 25
    assert profile["pricing"][0]["reverse_shipping_overridden"] is True
    cleared = await client.put(f"{ROOT}/1/reverse-shipping", json={
        "platform_id": 1, "charge": None})
    assert cleared.status_code == 200
    await db.refresh(pricing)
    assert pricing.cr_cost == 9


@pytest.mark.asyncio
async def test_catalogue_read_scope_and_shared_unit_stock(client, db):
    listing = await client.get(ROOT)
    assert listing.status_code == 200
    assert [x["our_sku"] for x in listing.json()["items"]] == ["AUDIT-SKU"]
    assert (await client.get(f"{ROOT}/2")).status_code == 404
    assert (await client.get(f"{ROOT}/1")).json()["performance"]["identity_linked_rows"] == 0

    await owner(db)
    db.add_all([
        Sku(company_id=1, shringar_sku="AUDIT-P2"),
        Sku(company_id=1, shringar_sku="AUDIT-P6"),
    ])
    await db.commit()
    skus = (await db.scalars(select(Sku).where(Sku.company_id == 1))).all()
    by_name = {s.shringar_sku: s.id for s in skus}
    r = await client.post(f"{ROOT}/stock-items", json={"name": "Shared glass", "base_unit": "piece"})
    assert r.status_code == 201, r.text
    item_id = r.json()["id"]
    for code, pack in [("AUDIT-SKU", 1), ("AUDIT-P2", 2), ("AUDIT-P6", 6)]:
        link = await client.post(f"{ROOT}/{by_name[code]}/stock-link",
            json={"stock_item_id": item_id, "base_units_per_sku": pack})
        assert link.status_code == 200, link.text
    opening = await client.post(f"{ROOT}/{by_name['AUDIT-SKU']}/movements", json={
        "movement_type": "opening", "sku_quantity": 120, "movement_date": TODAY,
        "request_key": str(uuid4())})
    assert opening.status_code == 201, opening.text
    for code, expected in [("AUDIT-SKU", 120), ("AUDIT-P2", 60), ("AUDIT-P6", 20)]:
        profile = (await client.get(f"{ROOT}/{by_name[code]}")).json()
        assert profile["on_hand_pack_equivalent"] == expected
        assert len(profile["siblings"]) == 3
    key = str(uuid4())
    dispatch = {"movement_type": "dispatch", "sku_quantity": 1,
        "movement_date": TODAY, "request_key": key, "reason": "order"}
    sent = await client.post(f"{ROOT}/{by_name['AUDIT-P6']}/movements", json=dispatch)
    assert sent.status_code == 201, sent.text
    assert sent.json()["base_units_delta"] == -6
    assert (await client.post(f"{ROOT}/{by_name['AUDIT-P6']}/movements",
        json=dispatch)).json()["replayed"] is True
    bad_replay = await client.post(f"{ROOT}/{by_name['AUDIT-P6']}/movements",
        json={**dispatch, "sku_quantity": 2})
    assert bad_replay.status_code == 409
    oversell = await client.post(f"{ROOT}/{by_name['AUDIT-P6']}/movements", json={
        **dispatch, "sku_quantity": 20, "request_key": str(uuid4())})
    assert oversell.status_code == 409
    no_inspection = await client.post(f"{ROOT}/{by_name['AUDIT-P6']}/movements", json={
        **dispatch, "movement_type": "return", "request_key": str(uuid4())})
    assert no_inspection.status_code == 422
    reverse = await client.post(f"{ROOT}/movements/{sent.json()['id']}/reverse",
        json={"movement_date": TODAY, "reason": "Order cancelled"})
    assert reverse.status_code == 200, reverse.text
    assert reverse.json()["on_hand_base_units"] == 120
    assert (await client.post(f"{ROOT}/movements/{sent.json()['id']}/reverse",
        json={"movement_date": TODAY, "reason": "Order cancelled"})).json()["replayed"] is True
    assert (await client.delete(f"/api/v1/skus/{by_name['AUDIT-P6']}")).status_code == 409


@pytest.mark.asyncio
async def test_approved_cost_is_previewed_before_pricing_change(client, db):
    await owner(db)
    created = await client.post(f"{ROOT}/stock-items", json={"name": "Cost pool"})
    assert created.status_code == 201
    item_id = created.json()["id"]
    assert (await client.post(f"{ROOT}/1/stock-link",
        json={"stock_item_id": item_id, "base_units_per_sku": 2})).status_code == 200
    before = (await client.get(f"{ROOT}/1")).json()
    assert before["purchase_cost"] == 100
    approved = await client.post(f"{ROOT}/stock-items/{item_id}/costs", json={
        "source_type": "manual", "cost_per_base_unit": 60, "effective_date": TODAY,
        "note": "Verified supplier quote"})
    assert approved.status_code == 201, approved.text
    after = (await client.get(f"{ROOT}/1")).json()
    assert after["purchase_cost"] == 120
    assert after["pricing"][0]["price"] == 100
    preview = (await client.get(f"{ROOT}/stock-items/{item_id}/cost-preview")).json()
    assert preview["updates"][0]["after"] == 120
    assert (await client.post(f"{ROOT}/stock-items/{item_id}/cost-apply",
        json={"token": "0" * 64})).status_code == 409
    applied = await client.post(f"{ROOT}/stock-items/{item_id}/cost-apply",
        json={"token": preview["token"]})
    assert applied.status_code == 200, applied.text
    assert (await client.get(f"{ROOT}/1")).json()["pricing"][0]["price"] == 120
    history = (await client.get("/api/v1/change-history/")).json()
    change = next(row for row in history if row["entity_type"] == "sku_pricing"
        and row["action"] == "update" and row["after"]["price"] == 120)
    assert change["undo_available"] is True
    undone = await client.post(f"/api/v1/change-history/{change['id']}/undo")
    assert undone.status_code == 200, undone.text
    pricing = await db.scalar(select(SkuPricing).where(SkuPricing.id == 1))
    assert pricing.price == 100
    assert (await client.get(f"{ROOT}/1")).json()["pricing"][0]["price"] == 100, change


@pytest.mark.asyncio
async def test_images_are_private_and_tenant_scoped(client, db, monkeypatch, tmp_path):
    await owner(db)
    monkeypatch.setattr(settings, "PRODUCT_MEDIA_DIR", str(tmp_path))
    image = Image.new("RGB", (32, 32), "red")
    buf = BytesIO()
    image.save(buf, format="PNG")
    foreign = await client.post(f"{ROOT}/2/images", files={"file": ("test.png", buf.getvalue(), "image/png")})
    assert foreign.status_code == 404
    uploaded = await client.post(f"{ROOT}/1/images", files={"file": ("test.png", buf.getvalue(), "image/png")})
    assert uploaded.status_code == 201, uploaded.text
    image_id = uploaded.json()["id"]
    assert (await client.get(f"{ROOT}/images/{image_id}")).headers["content-type"] == "image/webp"
    assert (await client.get(f"{ROOT}/images/{image_id}", params={"thumb": True})).status_code == 200
    assert (await client.get(f"{ROOT}/1")).json()["primary_image_id"] == image_id
    assert (await client.delete(f"{ROOT}/images/{image_id}")).status_code == 204
    assert (await client.get(f"{ROOT}/images/{image_id}")).status_code == 404


@pytest.mark.asyncio
async def test_confirmed_bill_cost_keeps_base_unit_precision(client, db):
    await owner(db)
    item = await client.post(f"{ROOT}/stock-items", json={"name": "Twelve-piece box"})
    item_id = item.json()["id"]
    await client.post(f"{ROOT}/1/stock-link", json={
        "stock_item_id": item_id, "base_units_per_sku": 12})
    bill = PurchaseBill(company_id=1, supplier_key="qa", ref_no="QA-245",
        bill_date=date.today())
    db.add(bill)
    await db.flush()
    line = PurchaseBillLine(bill_id=bill.id, item_name="Twelve-piece box",
        sku_id=1, match_source="manual", price_unit=245,
        pack_multiple=1, quantity=1, unit="box", pieces_per_unit=12)
    db.add(line)
    await db.commit()
    approved = await client.post(f"{ROOT}/stock-items/{item_id}/costs", json={
        "source_type": "bill_line", "source_id": line.id, "effective_date": TODAY})
    assert approved.status_code == 201, approved.text
    assert approved.json()["cost_per_base_unit"] == 20.4167
    product = (await client.get(f"{ROOT}/1")).json()
    assert product["purchase_cost"] == 245
    assert product["pricing_cost_drift"] is True


@pytest.mark.asyncio
async def test_product_profit_uses_frozen_cost_and_flags_overlapping_reports(client, db):
    for index, start, end, units in [
        (1, date(2026, 9, 1), date(2026, 9, 15), 1),
        (2, date(2026, 9, 1), date(2026, 9, 15), 2),
        (3, date(2026, 9, 10), date(2026, 9, 20), 3),
    ]:
        report = PnlReport(company_id=1, platform_id=1, period_start=start,
            period_end=end, filename=f"synthetic-{index}.xlsx", uploaded_by=1,
            status="done")
        db.add(report)
        await db.flush()
        db.add(PnlSkuRow(company_id=1, report_id=report.id,
            platform_sku_name="AUDIT-SKU", sku_pricing_id=1,
            gross_units=units, net_units=units, rvp_units=0, rto_units=0,
            bank_settlement_projected=150 * units, snap_breakeven=100,
            snap_cogs_per_unit=100))
    await db.commit()
    product = (await client.get(f"{ROOT}/1")).json()
    performance = product["performance"]
    assert performance["gross_units"] == 5
    assert performance["profit"] == 250
    assert performance["profit_rows"] == 2
    assert performance["overlapping_periods"] is True
    assert all(row["cost_frozen"] for row in performance["report_rows"])
    assert product["pricing"][0]["price"] == 100


@pytest.mark.asyncio
@pytest.mark.parametrize("unit,pieces,rate,sku_pieces,expected", [
    ("piece", 1, 15, 6, 15), ("box", 6, 90, 1, 15), ("box", 6, 90, 6, 15),
])
async def test_supplier_units_persist_and_approve(client, db, unit, pieces, rate, sku_pieces, expected):
    await owner(db)
    item_id = (await client.post(f"{ROOT}/stock-items", json={"name": "Unit test item"})).json()["id"]
    await client.post(f"{ROOT}/1/stock-link", json={"stock_item_id": item_id, "base_units_per_sku": sku_pieces})
    bill = PurchaseBill(company_id=1, supplier_key="units", ref_no="UNITS", bill_date=date.today())
    db.add(bill)
    await db.flush()
    line = PurchaseBillLine(bill_id=bill.id, item_name="Glass", sku_id=1,
        match_source="manual", price_unit=rate, pack_multiple=1)
    db.add(line)
    await db.commit()
    url = f"/api/v1/billing/purchase-bills/lines/{line.id}/units"
    assert (await client.patch(url, json={"unit": unit, "pieces_per_unit": pieces})).status_code == 200
    assert (await client.patch(url, json={"unit": "piece", "pieces_per_unit": 6})).status_code == 422
    assert (await client.patch(url, json={"unit": "box", "pieces_per_unit": 0})).status_code == 422
    assert (await client.patch(url.replace(str(line.id), "999999"), json={"unit": "piece", "pieces_per_unit": 1})).status_code == 404
    from app.services.purchase import bills_view
    view = await bills_view(db, 1, None)
    saved = next(l for b in view for l in b["lines"] if l["id"] == line.id)
    assert saved["unit"] == unit
    assert saved["pieces_per_unit"] == pieces
    assert saved["unit_cost"] == expected
    result = await client.post(f"{ROOT}/stock-items/{item_id}/costs", json={
        "source_type": "bill_line", "source_id": line.id, "effective_date": TODAY})
    assert result.status_code == 201, result.text
    assert result.json()["cost_per_base_unit"] == 15
    assert (await client.patch(url, json={"unit": "box", "pieces_per_unit": pieces + 1})).status_code == 409
    options = await client.get("/api/v1/billing/purchase-bills/sku-options")
    assert options.status_code == 200, options.text
    assert any(s["id"] == 1 for s in options.json())


@pytest.mark.asyncio
async def test_simple_bill_edit_updates_rate_totals_and_ledger(client, db):
    await owner(db)
    bill = PurchaseBill(company_id=1, supplier_key="edit", ref_no="EDIT", bill_date=date.today(), total=900, lines_total=900)
    db.add(bill)
    await db.flush()
    line = PurchaseBillLine(bill_id=bill.id, item_name="Glass", quantity=6, amount=900, price_unit=150)
    db.add(line)
    await db.commit()
    url = f"/api/v1/billing/purchase-bills/lines/{line.id}"
    payload = {"bill_date": TODAY, "ref_no": "EDIT2", "item_name": "Glass corrected", "quantity": 6, "amount": 1200, "unit": "box", "pieces_per_unit": 4}
    response = await client.patch(url, json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["price"] == 200
    await db.refresh(line)
    assert line.unit == "box" and line.pieces_per_unit == 4
    assert line.edited_at is not None
    await db.refresh(bill)
    assert bill.total == 1200
    assert bill.lines_total == 1200
    from app.models.ledger import LedgerEntry
    entry = await db.get(LedgerEntry, bill.ledger_entry_id)
    assert entry.amount == 1200
    assert entry.reference_no == "EDIT2"
    assert (await client.patch(url, json={**payload, "quantity": 0})).status_code == 422


@pytest.mark.asyncio
async def test_box_unit_cost_visible_before_sku_matching(client, db):
    await owner(db)
    bill = PurchaseBill(company_id=1, supplier_key="unmatched", ref_no="BOX-4", bill_date=date.today(), total=1080, lines_total=1080)
    db.add(bill)
    await db.flush()
    line = PurchaseBillLine(bill_id=bill.id, item_name="Unmatched box", quantity=4,
        unit="box", pieces_per_unit=4, price_unit=270, amount=1080)
    db.add(line)
    await db.commit()
    from app.services.purchase import bills_view
    saved = next(l for b in await bills_view(db, 1, None) for l in b["lines"] if l["id"] == line.id)
    assert saved["unit_cost"] == 67.5
    assert saved["cost_diff"] is None


@pytest.mark.asyncio
async def test_approved_bill_reupload_preserves_cost_source(client, db):
    await owner(db)
    item_id = (await client.post(f"{ROOT}/stock-items", json={"name": "Reupload guard"})).json()["id"]
    await client.post(f"{ROOT}/1/stock-link", json={"stock_item_id": item_id, "base_units_per_sku": 1})
    from app.services.purchase import save_bills
    parsed = [{"ref_no": "R-1", "date": "01/10/2026", "txn_type": "Sale", "total": 270,
        "items": [{"name": "Glass", "quantity": 1, "unit": "piece", "price_unit": 270, "amount": 270}]}]
    await save_bills(db, 1, None, "Supplier", parsed, "original.pdf")
    bill = await db.scalar(select(PurchaseBill).where(PurchaseBill.ref_no == "R-1"))
    line = bill.lines[0]
    line.sku_id, line.match_source, line.unit, line.pieces_per_unit = 1, "manual", "piece", 1
    await db.commit()
    approval = await client.post(f"{ROOT}/stock-items/{item_id}/costs", json={
        "source_type": "bill_line", "source_id": line.id, "effective_date": TODAY})
    assert approval.status_code == 201, approval.text
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        await save_bills(db, 1, None, "Supplier", parsed, "reupload.pdf")
    assert exc.value.status_code == 409
    await db.refresh(line)
    assert line.price_unit == 270
    assert await db.get(PurchaseBillLine, line.id) is not None


@pytest.mark.asyncio
async def test_reupload_refuses_manually_edited_bill_without_changing_earlier_bills(client, db):
    await owner(db)
    from app.services.purchase import save_bills
    parsed = [{"ref_no": ref, "date": "01/10/2026", "txn_type": "Sale", "total": 270,
        "items": [{"name": "Glass", "quantity": 1, "price_unit": 270, "amount": 270}]}
        for ref in ("FIRST", "EDITED")]
    await save_bills(db, 1, None, "Supplier", parsed, "original.pdf")
    bill = await db.scalar(select(PurchaseBill).where(PurchaseBill.ref_no == "EDITED"))
    line = bill.lines[0]
    response = await client.patch(f"/api/v1/billing/purchase-bills/lines/{line.id}", json={
        "bill_date": TODAY, "ref_no": "EDITED", "item_name": "Corrected glass",
        "quantity": 1, "amount": 270, "unit": "box", "pieces_per_unit": 4})
    assert response.status_code == 200, response.text
    changed = [{**b, "total": 999, "items": [{**b["items"][0], "amount": 999, "price_unit": 999}]}
        for b in parsed]
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        await save_bills(db, 1, None, "Supplier", changed, "reupload.pdf")
    assert exc.value.status_code == 409
    assert "manual edits" in exc.value.detail
    first = await db.scalar(select(PurchaseBill).where(PurchaseBill.ref_no == "FIRST"))
    await db.refresh(bill)
    await db.refresh(first)
    assert first.total == 270
    assert bill.lines[0].item_name == "Corrected glass"
    assert bill.lines[0].pieces_per_unit == 4
