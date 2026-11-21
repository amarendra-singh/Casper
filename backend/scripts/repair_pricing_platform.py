"""Copy a foreign pricing platform into its owning company without repricing.

Run from backend: python -m scripts.repair_pricing_platform --company-id 8
--source-platform-id 1 [--apply]. Back up and migrate the database first.
The default is a read-only preview; apply is transactional and repeatable.
"""

import argparse
import json

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

import app.models  # noqa: F401 — registers transactional financial history
from app.core.config import settings
from app.models.company import Company
from app.models.platform import Platform, PlatformTier
from app.models.sku import SkuPricing

PLATFORM_SETTINGS = (
    "cr_charge",
    "cr_percentage",
    "default_ad_pct",
    "default_profit_pct",
    "target_monthly_units",
    "is_active",
)


def repair(session: Session, company_id: int, source_platform_id: int, *, apply: bool = False):
    company = session.get(Company, company_id)
    source = session.get(Platform, source_platform_id)
    if company is None or source is None:
        raise ValueError("Company and source platform must exist")
    if source.company_id == company_id:
        raise ValueError("Source platform already belongs to this company")
    rows = list(
        session.scalars(
            select(SkuPricing).where(
                SkuPricing.company_id == company_id,
                SkuPricing.platform_id == source_platform_id,
            )
        )
    )
    summary = {
        "company_id": company_id,
        "source_platform_id": source_platform_id,
        "pricing_ids": [row.id for row in rows],
        "repaired_count": 0,
        "target_platform_id": None,
        "applied": apply,
    }
    if not rows or not apply:
        return summary
    # Never silently merge a foreign platform into an existing local platform:
    # similar names do not prove that their fees/settings have the same meaning.
    existing = session.scalar(
        select(Platform).where(
            Platform.company_id == company_id,
            Platform.name == source.name,
        )
    )
    if existing is not None:
        raise ValueError("Company already has this platform name; explicit mapping review is required")
    target = Platform(
        company_id=company_id, name=source.name, **{key: getattr(source, key) for key in PLATFORM_SETTINGS}
    )
    session.add(target)
    session.flush()
    for tier in source.tiers:
        if tier.company_id != source.company_id:
            raise ValueError("Source platform has an invalid tier ownership")
        session.add(
            PlatformTier(
                company_id=company_id,
                platform_id=target.id,
                tier_name=tier.tier_name,
                fee=tier.fee,
                fee_pct=tier.fee_pct,
            )
        )
    for row in rows:
        # Stable pricing IDs preserve report links and cost snapshots. Changing
        # only this FK also records before/after through financial history hooks.
        row.platform_id = target.id
    session.flush()
    summary.update(target_platform_id=target.id, repaired_count=len(rows))
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--company-id", required=True, type=int)
    parser.add_argument("--source-platform-id", required=True, type=int)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    engine = create_engine(settings.DATABASE_URL_SYNC)
    try:
        with Session(engine) as session, session.begin():
            result = repair(session, args.company_id, args.source_platform_id, apply=args.apply)
        print(json.dumps(result, indent=2))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
