"""Audit regression coverage: secure/correct behavior on synthetic records.

Run from backend with SECRET_KEY set:
    env/Scripts/python -m pytest tests/test_audit_regressions.py -q
All records are synthetic and held in a foreign-key-enforced in-memory DB.
"""

from datetime import date
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

import app.models
from app.core.database import Base, get_db, configure_sqlite_transactions
from app.core.security import create_access_token
from app.main import app
from app.models.user import User, UserRole
from app.models.company import Company, CompanyMembership, CompanyRole
from app.models.platform import Platform
from app.models.vendor import Vendor
from app.models.sku import Sku, SkuPricing
from app.models.purchase import PurchaseBill, PurchaseBillLine
from app.models.billing import Invoice


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    configure_sqlite_transactions(engine)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        session.add_all(
            [
                User(id=1, name="A", email="a@audit.example", password_hash="x", role=UserRole.admin),
                User(id=2, name="B", email="b@audit.example", password_hash="x", role=UserRole.viewer),
            ]
        )
        await session.flush()
        session.add_all(
            [
                Company(id=1, name="A", slug="audit-a", owner_id=1),
                Company(id=2, name="B", slug="audit-b", owner_id=2),
            ]
        )
        await session.flush()
        session.add_all(
            [
                CompanyMembership(company_id=1, user_id=1, role=CompanyRole.viewer),
                CompanyMembership(company_id=2, user_id=2, role=CompanyRole.owner),
                Platform(id=1, name="Flipkart", company_id=1, cr_charge=0, cr_percentage=0),
                Platform(id=2, name="Flipkart", company_id=2, cr_charge=0, cr_percentage=0),
                Vendor(id=2, name="Foreign vendor", short_code="FV", company_id=2),
                Sku(id=1, shringar_sku="AUDIT-SKU", company_id=1),
                Sku(id=2, shringar_sku="FOREIGN-SKU", company_id=2),
            ]
        )
        await session.flush()
        session.add(
            SkuPricing(
                id=1,
                company_id=1,
                sku_id=1,
                platform_id=1,
                price=100,
                package=0,
                logistics=0,
                addons=0,
                misc_total=0,
                gst=0,
                profit_percentage=20,
                cr_percentage=0,
                cr_cost=0,
                damage_percentage=0,
                damage_cost=0,
                breakeven=100,
                net_profit_amt=20,
                bs_wo_gst=120,
                bank_settlement=120,
            )
        )
        await session.commit()
        yield session
    await engine.dispose()


@pytest_asyncio.fixture
async def client(db):
    async def override():
        yield db
        await db.commit()

    app.dependency_overrides[get_db] = override
    token = create_access_token({"sub": "1"})
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://audit",
        headers={"Authorization": f"Bearer {token}", "X-Company-Id": "1"},
    ) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_download_requires_report_ownership(client, tmp_path, monkeypatch):
    import app.routes.pnl as routes

    monkeypatch.setattr(routes, "UPLOADS_DIR", tmp_path)
    (tmp_path / "999.xlsx").write_bytes(b"foreign report contents")
    r = await client.get("/api/v1/pnl/reports/999/file")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_platform_directory_rejects_company_admin(client):
    r = await client.get("/api/v1/users/")
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_company_viewer_cannot_upsert_costs(client, db):
    r = await client.post("/api/v1/entries/upsert-batch", json={"rows": [{"sku": "AUDIT-SKU", "price": 999}]})
    assert r.status_code == 403
    assert (await db.get(SkuPricing, 1)).price == 100


@pytest.mark.asyncio
async def test_sku_rejects_foreign_company_vendor(client, db):
    member = await db.scalar(
        select(CompanyMembership).where(CompanyMembership.company_id == 1, CompanyMembership.user_id == 1)
    )
    member.role = CompanyRole.owner
    await db.commit()
    r = await client.post("/api/v1/skus/", json={"shringar_sku": "CROSS-TENANT", "vendor_id": 2})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_purchase_cost_requires_confirmation_and_recalculates(db):
    from app.services.purchase import apply_cost

    bill = PurchaseBill(company_id=1, ref_no="COST", bill_date=date(2026, 1, 1))
    db.add(bill)
    await db.flush()
    line = PurchaseBillLine(
        bill_id=bill.id,
        item_name="AUDIT-SKU",
        sku_id=1,
        match_source="suggested",
        price_unit=200,
        pack_multiple=1,
    )
    db.add(line)
    await db.commit()
    result = await apply_cost(db, 1, line.id)
    pricing = await db.get(SkuPricing, 1)
    assert result["ok"] is False
    assert pricing.price == 100
    line.match_source = "manual"
    await db.commit()
    result = await apply_cost(db, 1, line.id)
    assert result["ok"] is True
    assert pricing.price == 200
    assert pricing.breakeven == 200 and pricing.bank_settlement == 240


@pytest.mark.asyncio
async def test_supplier_identity_keeps_same_reference_separate(db):
    from app.services.purchase import save_bills

    def parsed(amount):
        return [{"ref_no": "1", "date": "01/01/2026", "total": amount, "items": []}]

    await save_bills(db, 1, None, "Supplier A", parsed(100), "a.pdf")
    result = await save_bills(db, 1, None, "Supplier B", parsed(200), "b.pdf")
    bills = (await db.execute(select(PurchaseBill))).scalars().all()
    assert result["bills_created"] == 1 and len(bills) == 2
    assert bills[0].party_name == "Supplier A" and bills[0].total == 100
    assert bills[1].party_name == "Supplier B" and bills[1].total == 200


def test_statement_keeps_signed_reconciliation_adjustment():
    from app.services.pnl_statement import build_pnl_statement

    stmt = build_pnl_statement(
        [
            {
                "net_units": 1,
                "gross_units": 1,
                "matched": True,
                "bank_settlement_projected": 95,
                "commission_fee": 10,
            }
        ],
        {"gross_sales": 100, "net_sales": 100, "bank_settlement": 95},
    )
    amounts = {l["key"]: l["amount"] for l in stmt["lines"]}
    assert amounts["net_sales"] + amounts["commission"] + amounts["other_fees"] == 95
    assert amounts["net_payout"] == 95


def test_report_detail_preserves_frozen_cost_basis():
    from app.routes.pnl import _build_sku_row_response
    from app.models.pnl import PnlSkuRow
    from app.services.pnl_statement import _cost_basis

    sp = SimpleNamespace(
        price=200,
        package=0,
        logistics=0,
        addons=0,
        misc_total=0,
        cr_percentage=0,
        cr_cost=0,
        damage_percentage=0,
        damage_cost=0,
        breakeven=200,
        gst=0,
        net_profit_amt=40,
        bank_settlement=240,
        profit_percentage=20,
    )
    row = PnlSkuRow(
        id=1,
        report_id=1,
        company_id=1,
        platform_sku_name="AUDIT-SKU",
        sku_pricing_id=1,
        net_units=1,
        gross_units=1,
        snap_breakeven=100,
        snap_cogs_per_unit=100,
        casper_expected_bs=120,
    )
    row.sku_pricing = SkuPricing(
        price=sp.price,
        package=0,
        logistics=0,
        addons=0,
        misc_total=0,
        cr_percentage=0,
        cr_cost=0,
        damage_percentage=0,
        damage_cost=0,
        breakeven=200,
        gst=0,
        net_profit_amt=40,
        bank_settlement=240,
        profit_percentage=20,
    )
    detail = _build_sku_row_response(row)
    basis, frozen = _cost_basis(row)
    assert frozen and basis["breakeven"] == 100
    assert detail.casper_breakeven == 100 and detail.casper_expected_bs == 120


@pytest.mark.asyncio
async def test_invoice_sequence_does_not_reuse_existing_number(db):
    from app.services.billing import next_invoice_number

    year = date.today().year
    for n in (1, 3):  # invoice 2 was deleted
        db.add(
            Invoice(
                company_id=1, number=f"INV-{year}-{n:04d}", invoice_date=date.today(), customer_name="Audit"
            )
        )
    await db.commit()
    assert await next_invoice_number(db, 1) == f"INV-{year}-0004"


@pytest.mark.asyncio
async def test_fk_orders_uses_own_company_platform(client, db, monkeypatch):
    import app.services.fraud as fraud

    monkeypatch.setattr(
        fraud,
        "extract_order_events_fk_orders",
        lambda _: [{"sku_platform_name": "FOREIGN-SKU", "order_status": "RETURNED"}],
    )

    async def noop(*args, **kwargs):
        return None

    for name in (
        "compute_return_reason_clusters",
        "compute_state_risk_profiles",
        "compute_actor_risk_profiles",
    ):
        monkeypatch.setattr(fraud, name, noop)
    r = await client.post(
        "/api/v1/pnl/upload/fk-orders",
        headers={"Authorization": f"Bearer {create_access_token({'sub': '2'})}", "X-Company-Id": "2"},
        files={"file": ("orders.xlsx", b"audit", "application/octet-stream")},
    )
    assert r.status_code == 200
    from app.models.fraud import OrderEvent

    stored = (await db.execute(select(OrderEvent))).scalar_one()
    assert stored.company_id == 2 and stored.platform_id == 2


@pytest.mark.asyncio
async def test_backfill_rejects_foreign_report(client, db, monkeypatch, tmp_path):
    from app.models.pnl import PnlReport
    import app.services.fraud as fraud

    db.add(
        PnlReport(
            id=50,
            company_id=2,
            platform_id=2,
            uploaded_by=2,
            filename="foreign.xlsx",
            period_start=date(2026, 1, 1),
            period_end=date(2026, 1, 31),
        )
    )
    await db.commit()
    monkeypatch.chdir(tmp_path)
    folder = tmp_path / "uploads" / "pnl"
    folder.mkdir(parents=True)
    (folder / "50.xlsx").write_bytes(b"audit")
    monkeypatch.setattr(fraud, "extract_order_events_fk", lambda _: [])

    async def noop(*args, **kwargs):
        return None

    for name in (
        "compute_sku_risk_scores",
        "compute_return_reason_clusters",
        "compute_state_risk_profiles",
        "compute_actor_risk_profiles",
        "generate_fraud_alerts",
    ):
        monkeypatch.setattr(fraud, name, noop)
    r = await client.post("/api/v1/fraud/backfill/50")
    assert r.status_code in (403, 404)


def test_pricing_engines_agree():
    from app.services.pricing import calculate_pricing as direct
    from app.services.entries import calculate_pricing as batch

    values = dict(
        price=90.5,
        package=0,
        logistics=0,
        addons=0,
        misc_total=0,
        cr_cost=0,
        damage_cost=0,
        profit_percentage=20,
    )
    a = direct(**values, gst=5)
    b = batch(**values, cr_percentage=0, damage_percentage=0, gst_rate=5)
    assert a["bank_settlement"] == 114.45
    assert b["bank_settlement"] == a["bank_settlement"]


@pytest.mark.asyncio
async def test_pnl_rows_applies_gst_percentage(db):
    from app.models.pnl import PnlReport, PnlSkuRow
    from app.services.pnl_statement import compute_pnl_rows

    db.add(
        PnlReport(
            id=60,
            company_id=1,
            platform_id=1,
            uploaded_by=1,
            filename="gst.xlsx",
            period_start=date(2026, 1, 1),
            period_end=date(2026, 1, 31),
        )
    )
    await db.flush()
    db.add(
        PnlSkuRow(
            report_id=60,
            company_id=1,
            sku_pricing_id=1,
            platform_sku_name="AUDIT-SKU",
            gross_units=1,
            net_units=1,
            bank_settlement_projected=300,
            snap_breakeven=200,
            snap_cogs_per_unit=200,
            snap_gst=18,
        )
    )
    await db.commit()
    result = await compute_pnl_rows(db, 60, 1)
    assert result["rows"][0]["casper_breakeven_gst"] == 236


@pytest.mark.asyncio
async def test_explicit_clear_removes_platform_override(db):
    from app.models.sku import SkuPlatformConfig
    from app.schemas.entries import PlatformOverride
    from app.services.entries import _upsert_platform_configs

    cfg = SkuPlatformConfig(
        company_id=1, sku_pricing_id=1, platform_id=1, ad_pct=10, platform_sku_name="OLD-ALIAS"
    )
    db.add(cfg)
    await db.commit()
    await _upsert_platform_configs(db, await db.get(SkuPricing, 1), [PlatformOverride(platform_id=1)])
    await db.commit()
    assert await db.scalar(select(SkuPlatformConfig).where(SkuPlatformConfig.id == cfg.id)) is None


@pytest.mark.asyncio
async def test_bad_batch_row_does_not_poison_valid_rows(db):
    from app.services.entries import upsert_batch
    from app.schemas.entries import EntryRowInput

    saved, errors = await upsert_batch(
        db,
        [
            EntryRowInput(sku="GOOD", price=100),
            EntryRowInput(sku="BAD", price=100, vendor_id=99999),
        ],
        1,
    )
    assert len(saved) == 1 and len(errors) == 1
    await db.commit()
    assert await db.scalar(select(Sku).where(Sku.shringar_sku == "GOOD")) is not None
    assert await db.scalar(select(Sku).where(Sku.shringar_sku == "BAD")) is None


def test_legacy_paid_status_does_not_hide_outstanding_balance():
    from app.services.billing import build_billing_summary

    result = build_billing_summary(
        [{"status": "paid", "total": 100, "amount_paid": 0, "due_date": None}], date(2026, 1, 1)
    )
    assert result["outstanding"] == 100 and result["total_paid"] == 0


@pytest.mark.asyncio
async def test_logout_revokes_access_and_refresh(client, db):
    from app.core.security import create_refresh_token

    token = create_refresh_token({"sub": "1", "ver": 0})
    assert (await client.post("/api/v1/auth/logout")).status_code == 200
    assert (await client.get("/api/v1/auth/me")).status_code == 401
    assert (await client.post("/api/v1/auth/refresh", json={"refresh_token": token})).status_code == 401


@pytest.mark.asyncio
async def test_refresh_rotation_rejects_replay(client):
    from app.core.security import create_refresh_token

    token = create_refresh_token({"sub": "1", "ver": 0})
    response = await client.post("/api/v1/auth/refresh", json={"refresh_token": token})
    assert response.status_code == 200, response.text
    assert response.json()["refresh_token"] != token
    assert (await client.post("/api/v1/auth/refresh", json={"refresh_token": token})).status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "path,payload",
    [
        ("/api/v1/pnl/hidden-skus/add", {"platform_sku_name": "NEW", "price": 20, "report_id": 999}),
        ("/api/v1/pnl/rematch/999", None),
        ("/api/v1/hsn/", {"code": "9999", "description": "Test", "gst_rate": 18}),
    ],
)
async def test_remaining_writes_reject_company_viewer(client, path, payload):
    headers = {"Authorization": f"Bearer {create_access_token({'sub': '2'})}"} if "/hsn/" in path else {}
    response = await client.post(path, json=payload, headers=headers)
    assert response.status_code == 403, response.text


@pytest.mark.asyncio
async def test_failed_replacement_preserves_old_report_and_source(client, db, tmp_path, monkeypatch):
    import app.routes.pnl as routes
    from app.models.pnl import PnlReport

    member = await db.scalar(
        select(CompanyMembership).where(CompanyMembership.company_id == 1, CompanyMembership.user_id == 1)
    )
    member.role = CompanyRole.owner
    old = PnlReport(
        company_id=1,
        platform_id=1,
        period_start=date(2026, 1, 1),
        period_end=date(2026, 1, 31),
        filename="old.xlsx",
        uploaded_by=1,
    )
    db.add(old)
    await db.commit()
    old_id = old.id
    old_path = tmp_path / f"{old_id}.xlsx"
    old_path.write_bytes(b"old source")
    monkeypatch.setattr(routes, "UPLOADS_DIR", tmp_path)
    monkeypatch.setattr(routes, "extract_period_from_bytes", lambda _: (date(2026, 1, 1), date(2026, 1, 31)))

    async def fail_parse(**kwargs):
        await kwargs["session"].delete(await kwargs["session"].get(PnlReport, old_id))
        await kwargs["session"].flush()
        raise ValueError("synthetic parser failure after deletion")

    monkeypatch.setattr(routes, "parse_and_store", fail_parse)
    response = await client.post(
        "/api/v1/pnl/upload",
        data={"platform_id": "1", "force": "true"},
        files={"file": ("new.xlsx", b"new bytes")},
    )
    assert response.status_code == 422, response.text
    assert await db.get(PnlReport, old_id) is not None
    assert old_path.read_bytes() == b"old source"
    assert list(tmp_path.iterdir()) == [old_path]


@pytest.mark.asyncio
async def test_duplicate_custom_invoice_number_returns_conflict(client, db):
    member = await db.scalar(
        select(CompanyMembership).where(CompanyMembership.company_id == 1, CompanyMembership.user_id == 1)
    )
    member.role = CompanyRole.owner
    await db.commit()
    payload = {
        "number": "CUSTOM-1",
        "invoice_date": "2026-01-01",
        "customer_name": "Test",
        "lines": [{"description": "Item", "quantity": 1, "unit_price": 10}],
    }
    assert (await client.post("/api/v1/billing/", json=payload)).status_code == 201
    assert (await client.post("/api/v1/billing/", json=payload)).status_code == 409
    assert (await client.get("/api/v1/billing/")).status_code == 200


@pytest.mark.asyncio
async def test_order_reupload_updates_status_without_duplicate_count(db):
    from app.services.fraud import store_order_events
    from app.models.fraud import OrderEvent

    row = {"external_order_id": "ORDER-1", "sku_platform_name": "AUDIT-SKU", "order_status": "DELIVERED"}
    await store_order_events(db, [row], None, 1, 1)
    await db.commit()
    await store_order_events(db, [{**row, "order_status": "RETURNED"}], None, 1, 1)
    await db.commit()
    events = (await db.scalars(select(OrderEvent))).all()
    assert len(events) == 1
    assert events[0].order_status == "RETURNED"


@pytest.mark.asyncio
async def test_financial_history_is_transactional_and_append_only(db):
    from app.models.audit import FinancialChange

    pricing = await db.get(SkuPricing, 1)
    db.sync_session.info["actor_id"] = 1
    pricing.price = 250
    await db.commit()
    history = (await db.scalars(select(FinancialChange).where(FinancialChange.action == "update"))).all()
    assert len(history) == 1
    change = history[0]
    assert change.company_id == 1 and change.actor_id == 1 and change.entity_id == 1
    assert change.before["price"] == 100 and change.after["price"] == 250
    pricing.price = 350
    await db.flush()
    await db.rollback()
    history = (await db.scalars(select(FinancialChange).where(FinancialChange.action == "update"))).all()
    assert len(history) == 1
    history[0].action = "tampered"
    with pytest.raises(ValueError, match="append-only"):
        await db.flush()
    await db.rollback()


def test_password_hashes_support_existing_bcrypt_and_new_long_passwords():
    import bcrypt
    from app.core.security import hash_password, verify_password

    legacy = bcrypt.hashpw(b"Existing-Password", bcrypt.gensalt()).decode()
    assert verify_password("Existing-Password", legacy)
    assert not verify_password("wrong", legacy)
    password = "LongStrongPassword-" * 10
    hashed = hash_password(password)
    assert hashed.startswith("$argon2")
    assert verify_password(password, hashed)
    assert not verify_password("anything", "malformed hash")


@pytest.mark.asyncio
async def test_password_change_revokes_prior_session(client, db):
    from app.core.security import hash_password, create_refresh_token

    user = await db.get(User, 1)
    user.password_hash = hash_password("Current-Password")
    await db.commit()
    refresh = create_refresh_token({"sub": "1", "ver": 0})
    response = await client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "Current-Password", "new_password": "New-Strong-Password"},
    )
    assert response.status_code == 200, response.text
    assert (await client.get("/api/v1/auth/me")).status_code == 401
    assert (await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})).status_code == 401


@pytest.mark.asyncio
async def test_prior_order_observations_do_not_inflate_actor_clusters(db):
    from app.models.fraud import OrderEvent, ReturnReasonCluster
    from app.services.fraud import compute_return_reason_clusters
    db.add(OrderEvent(company_id=1, platform_id=1, external_order_id='OLD',
        sku_platform_name='AUDIT-SKU', order_status='RETURNED', return_reason='Fraud',
        is_current=False))
    await db.commit()
    await compute_return_reason_clusters(db,1)
    await db.commit()
    assert (await db.scalars(select(ReturnReasonCluster))).all() == []


@pytest.mark.asyncio
async def test_history_read_requires_company_admin(client):
    assert (await client.get('/api/v1/change-history/')).status_code == 403


@pytest.mark.asyncio
async def test_base_cost_edit_survives_platform_deactivation(db):
    from app.services.entries import upsert_batch, get_all_entries
    from app.schemas.entries import EntryRowInput
    platform = await db.get(Platform,1)
    platform.is_active = False
    await db.commit()
    saved, errors = await upsert_batch(db,[EntryRowInput(sku='AUDIT-SKU',sku_id=1,price=275)],1)
    assert len(saved) == 1 and errors == []
    assert (await db.get(SkuPricing,1)).price == 275
    rows = await get_all_entries(db,1)
    assert rows[0]['price'] == 275
    assert rows[0]['base_platform_id'] == 1


@pytest.mark.asyncio
async def test_unit_economics_can_load_inactive_unpriced_catalogue_skus(client, db):
    from app.services.entries import get_all_entries
    db.add(Sku(company_id=1, shringar_sku='IMPORTED-P1', is_active=False))
    await db.commit()

    assert [row['shringar_sku'] for row in await get_all_entries(db, 1)] == ['AUDIT-SKU']
    ordinary = await client.get('/api/v1/entries/')
    assert ordinary.status_code == 200
    assert [row['shringar_sku'] for row in ordinary.json()] == ['AUDIT-SKU']
    response = await client.get('/api/v1/entries/', params={'include_inactive': 'true'})
    assert response.status_code == 200
    imported = next(row for row in response.json() if row['shringar_sku'] == 'IMPORTED-P1')
    assert imported['is_active'] is False
    assert imported['price'] is None


@pytest.mark.asyncio
async def test_legacy_foreign_platform_metadata_is_hidden_and_write_is_blocked(db):
    from app.services.entries import get_all_entries, upsert_batch
    from app.schemas.entries import EntryRowInput
    pricing = await db.get(SkuPricing,1)
    pricing.platform_id = 2
    foreign = await db.get(Platform,2)
    foreign.cr_charge = 9876
    await db.commit()
    db.expire_all()
    rows = await get_all_entries(db,1)
    assert rows[0]['base_reference_valid'] is False
    assert rows[0]['base_cr_charge'] is None
    saved, errors = await upsert_batch(db,[EntryRowInput(sku='AUDIT-SKU',sku_id=1,price=900)],1)
    assert saved == [] and len(errors) == 1
    assert 'foreign platform' in errors[0].error
    assert (await db.get(SkuPricing,1)).price == 100
