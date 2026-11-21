"""The administrative repair preserves money and stays within one transaction."""

import pytest
from sqlalchemy import create_engine, select, func, event
from sqlalchemy.orm import Session

import app.models
from app.core.database import Base
from app.models.audit import FinancialChange
from app.models.company import Company
from app.models.platform import Platform, PlatformTier
from app.models.sku import Sku, SkuPricing
from app.models.user import User, UserRole
from scripts.repair_pricing_platform import repair, PLATFORM_SETTINGS


@pytest.fixture
def engine():
    engine = create_engine("sqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    with Session(engine) as session, session.begin():
        session.add(
            User(
                id=1,
                name="Synthetic",
                email="repair@example.test",
                password_hash="unused",
                role=UserRole.admin,
            )
        )
        session.flush()
        session.add_all(
            [
                Company(id=1, name="Source", slug="source", owner_id=1),
                Company(id=2, name="Target", slug="target", owner_id=1),
            ]
        )
        session.flush()
        session.add(
            Platform(
                id=1,
                company_id=1,
                name="TestPlatform",
                cr_charge=50,
                cr_percentage=5,
                default_ad_pct=2,
                default_profit_pct=25,
                target_monthly_units=700,
                is_active=True,
            )
        )
        session.add(Sku(id=1, company_id=2, shringar_sku="REPAIR-TEST"))
        session.flush()
        session.add(PlatformTier(company_id=1, platform_id=1, tier_name="Gold", fee=5, fee_pct=3))
        session.add(
            SkuPricing(
                id=1,
                company_id=2,
                sku_id=1,
                platform_id=1,
                price=100,
                cr_percentage=5,
                cr_cost=2.5,
                damage_percentage=15,
                damage_cost=15,
                breakeven=120,
                net_profit_amt=30,
                bs_wo_gst=150,
                bank_settlement=177,
            )
        )
    yield engine
    engine.dispose()


def test_preview_is_read_only(engine):
    with Session(engine) as session, session.begin():
        result = repair(session, 2, 1)
        assert result["pricing_ids"] == [1]
        assert result["repaired_count"] == 0
        assert session.get(SkuPricing, 1).platform_id == 1
        assert session.scalar(select(func.count()).select_from(Platform)) == 1


def test_copy_preserves_prices_identity_and_records_history(engine):
    with Session(engine) as session, session.begin():
        row = session.get(SkuPricing, 1)
        preserved = {
            column.key: getattr(row, column.key)
            for column in SkuPricing.__table__.columns
            if column.key not in {"platform_id", "updated_at"}
        }
        source = session.get(Platform, 1)
        result = repair(session, 2, 1, apply=True)
        target = session.get(Platform, result["target_platform_id"])
        assert target.company_id == 2
        assert target.name == source.name
        assert all(getattr(target, key) == getattr(source, key) for key in PLATFORM_SETTINGS)
        assert len(target.tiers) == 1
        assert target.tiers[0].company_id == 2
        assert target.tiers[0].fee_pct == 3
        assert all(getattr(row, key) == value for key, value in preserved.items())
        history = session.scalar(select(FinancialChange).where(FinancialChange.action == "update"))
        assert history.company_id == 2
        assert history.before["platform_id"] == 1
        assert history.after["platform_id"] == target.id
    with Session(engine) as session, session.begin():
        assert repair(session, 2, 1, apply=True)["repaired_count"] == 0
        assert session.scalar(select(func.count()).select_from(Platform)) == 2


def test_failed_repair_rolls_back_prices_platform_tiers_and_history(engine):
    with pytest.raises(RuntimeError), Session(engine) as session, session.begin():
        repair(session, 2, 1, apply=True)
        raise RuntimeError("Synthetic transaction failure")
    with Session(engine) as session:
        assert session.get(SkuPricing, 1).platform_id == 1
        assert session.scalar(select(func.count()).select_from(Platform)) == 1
        assert session.scalar(select(func.count()).select_from(PlatformTier)) == 1
        assert (
            session.scalar(
                select(func.count()).select_from(FinancialChange).where(FinancialChange.action == "update")
            )
            == 0
        )


def test_existing_name_requires_mapping_review(engine):
    with Session(engine) as session, session.begin():
        session.add(Platform(company_id=2, name="TestPlatform", cr_charge=999, cr_percentage=20))
    with pytest.raises(ValueError, match="mapping review"), Session(engine) as session, session.begin():
        repair(session, 2, 1, apply=True)
    with Session(engine) as session:
        assert session.get(SkuPricing, 1).platform_id == 1
