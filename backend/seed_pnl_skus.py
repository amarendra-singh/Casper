"""
Seed Script — Flipkart P&L SKU Matching Data
=============================================
Creates Sku + SkuPricing + SkuPlatformConfig for all 84 Flipkart SKUs
from the uploaded March 2026 P&L report.

Variance distribution (realistic for testing):
  - Group A (30 SKUs): Casper overestimated → actual BELOW expectations
  - Group B (30 SKUs): Casper underestimated → actual BEAT expectations
  - Group C (24 SKUs): Roughly on target (within ±5%)

Run: python seed_pnl_skus.py
"""

import asyncio
import json
import random
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.models.sku import Sku, SkuPricing, SkuPlatformConfig
from app.models.platform import Platform

# ── Config ─────────────────────────────────────────────────────────────────────
DB_PATH  = os.path.join(os.path.dirname(__file__), "casper.db")
DB_URL   = f"sqlite+aiosqlite:///{DB_PATH}"
REPORT_JSON = r"C:\Users\MSI-PC\AppData\Local\Temp\pnl_report.json"

FLIPKART_PLATFORM_ID = 2
CR_CHARGE            = 170.0   # Flipkart's reverse shipping fee per return
CR_PERCENTAGE        = 25.0    # Our estimated return rate (%)
DAMAGE_PERCENTAGE    = 2.0     # Expected damage/loss (%)
GST_RATE             = 12.0    # GST %
PACKAGING_COST       = 20.0    # Flat ₹20 per unit packaging
TARGET_PROFIT_PCT    = 20.0    # Casper's target margin

random.seed(42)  # Reproducible results


def calculate_pricing(price: float, actual_epu: float, variance_factor: float) -> dict:
    """
    Build a SkuPricing record for a Flipkart SKU.

    price          = selling price per unit (acct_net_sales / net_units)
    actual_epu     = actual Flipkart earnings per unit (what we really got)
    variance_factor = multiplier on actual_epu to get our "pre-report estimate"
                      e.g. 1.15 = we expected 15% MORE than actual (overestimate)
                           0.88 = we expected 12% LESS than actual (underestimate)

    Key insight: bank_settlement = what Casper EXPECTED to receive per unit from Flipkart.
    This is our pre-report projection. The P&L comparison shows actual vs this estimate.
    """
    cr_cost         = CR_CHARGE * CR_PERCENTAGE / 100.0
    damage_cost     = round(price * DAMAGE_PERCENTAGE / 100.0, 2)
    breakeven       = round(price + PACKAGING_COST + cr_cost + damage_cost, 2)

    # Our projected net earnings per unit (with applied variance)
    projected_epu   = round(max(actual_epu * variance_factor, 1.0), 2)

    # Derive bs_wo_gst and bank_settlement from projected earnings
    # bank_settlement ≈ selling_price × (1 - platform_fee_rate) ≈ projected_epu
    # We model it as: selling_price + projected margin − fees
    # For simplicity: bank_settlement = projected_epu (per unit, after all fees)
    # profit_pct reflects our margin target relative to breakeven
    profit_amount   = projected_epu - breakeven
    profit_pct      = round((profit_amount / breakeven * 100), 1) if breakeven > 0 else TARGET_PROFIT_PCT

    # Clamp profit_pct to a realistic range (Flipkart fees can produce negative)
    profit_pct      = max(min(profit_pct, 60.0), -30.0)

    net_profit      = round(breakeven * (profit_pct / 100.0), 2)
    bs_wo_gst       = round(breakeven + net_profit)
    gst_amount      = round(bs_wo_gst * GST_RATE / 100.0)
    bank_settlement = float(projected_epu)  # what we expected per unit

    return {
        "cr_cost":          round(cr_cost, 2),
        "damage_cost":      damage_cost,
        "breakeven":        breakeven,
        "net_profit_amt":    net_profit,
        "bs_wo_gst":        float(bs_wo_gst),
        "bank_settlement":  bank_settlement,   # our projected net per unit
        "profit_pct":       profit_pct,
    }


async def main():
    # ── Load report SKU rows ──────────────────────────────────────────────────
    with open(REPORT_JSON) as f:
        report = json.load(f)

    rows = report["sku_rows"]
    print(f"Loaded {len(rows)} SKU rows from P&L report")

    # ── Assign variance groups ────────────────────────────────────────────────
    # variance_factor = multiplier on actual earnings_per_unit → our "pre-report estimate"
    #   Group A (30): overestimated → factor 1.15–1.35 (expected more than reality)
    #   Group B (30): underestimated → factor 0.75–0.90 (expected less than reality)
    #   Group C (24): roughly right → factor 0.96–1.04 (close to actual)
    indices = list(range(len(rows)))
    random.shuffle(indices)
    group_a = set(indices[:30])   # overestimated
    group_b = set(indices[30:60]) # underestimated
    # group_c = remaining 24

    def variance_factor_for(idx: int) -> float:
        if idx in group_a:
            return round(random.uniform(1.15, 1.35), 3)
        elif idx in group_b:
            return round(random.uniform(0.75, 0.90), 3)
        else:
            return round(random.uniform(0.96, 1.04), 3)

    # ── DB setup ──────────────────────────────────────────────────────────────
    engine  = create_async_engine(DB_URL, echo=False)
    Session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with Session() as session:
        # ── Clean existing test SKUs (idempotent run) ─────────────────────────
        print("Cleaning existing test SKUs for Flipkart platform config...")
        existing_configs = await session.execute(
            select(SkuPlatformConfig).where(
                SkuPlatformConfig.platform_id == FLIPKART_PLATFORM_ID
            )
        )
        config_rows = existing_configs.scalars().all()
        pricing_ids = [c.sku_pricing_id for c in config_rows]

        for cfg in config_rows:
            await session.delete(cfg)

        if pricing_ids:
            pricing_rows = await session.execute(
                select(SkuPricing).where(SkuPricing.id.in_(pricing_ids))
            )
            for pricing in pricing_rows.scalars().all():
                await session.delete(pricing)

        await session.flush()

        # ── Seed ──────────────────────────────────────────────────────────────
        created = 0
        skipped = 0

        for i, row in enumerate(rows):
            sku_name    = row["platform_sku_name"]
            net_units   = row["net_units"] or 0
            acct_sales  = row["accounted_net_sales"] or 0
            epu         = row["earnings_per_unit"]    # actual Flipkart earnings per unit

            # Skip SKUs with no meaningful data (0 net units, 0 sales)
            if net_units == 0 and acct_sales == 0:
                skipped += 1
                continue

            # Selling price per unit (from actual Flipkart data)
            price_per_unit = round(acct_sales / max(net_units, 1), 2)
            # Floor price at ₹50 to avoid nonsensical tiny values
            price_per_unit = max(price_per_unit, 50.0)

            # ── Get or create base Sku ─────────────────────────────────────────
            existing_sku = await session.execute(
                select(Sku).where(Sku.shringar_sku == sku_name)
            )
            sku = existing_sku.scalar_one_or_none()

            if not sku:
                sku = Sku(
                    shringar_sku=sku_name,
                    vendor_sku=sku_name,
                    description=f"Flipkart listing: {sku_name}",
                    series=sku_name.split("-")[0] if "-" in sku_name else None,
                    is_active=True,
                )
                session.add(sku)
                await session.flush()  # get sku.id

            # ── Create SkuPricing (Casper's pre-report estimate) ───────────────
            # Use actual earnings_per_unit as base; apply variance factor to
            # simulate our projection being slightly off from reality.
            # Falls back to a safe default if epu is missing/negative.
            safe_epu  = epu if (epu and epu > 5) else max(price_per_unit * 0.15, 10.0)
            vfactor   = variance_factor_for(i)
            calc      = calculate_pricing(price_per_unit, safe_epu, vfactor)
            profit_pct = calc["profit_pct"]

            pricing = SkuPricing(
                sku_id=sku.id,
                platform_id=FLIPKART_PLATFORM_ID,
                price=price_per_unit,
                package=PACKAGING_COST,
                logistics=0.0,
                addons=0.0,
                misc_total=0.0,
                gst=GST_RATE,
                profit_percentage=profit_pct,
                cr_percentage=CR_PERCENTAGE,
                cr_cost=calc["cr_cost"],
                damage_percentage=DAMAGE_PERCENTAGE,
                damage_cost=calc["damage_cost"],
                breakeven=calc["breakeven"],
                net_profit_amt=calc["net_profit_amt"],
                bs_wo_gst=calc["bs_wo_gst"],
                bank_settlement=calc["bank_settlement"],  # projected net per unit
            )
            session.add(pricing)
            await session.flush()  # get pricing.id

            # ── SkuPlatformConfig: links Flipkart name → Casper pricing ─────────
            config = SkuPlatformConfig(
                sku_pricing_id=pricing.id,
                platform_id=FLIPKART_PLATFORM_ID,
                platform_sku_name=sku_name,   # exact name from Flipkart report
                ad_pct=None,                   # inherit platform default
                profit_pct=None,
            )
            session.add(config)
            created += 1

        await session.commit()
        print(f"\nOK Seeded {created} SKUs  |  {skipped} skipped (zero units/sales)")

        # ── Verify ────────────────────────────────────────────────────────────
        total_configs = await session.scalar(
            select(SkuPlatformConfig).where(
                SkuPlatformConfig.platform_id == FLIPKART_PLATFORM_ID
            ).with_only_columns(SkuPlatformConfig.id)  # type: ignore
        )
        configs_count = await session.execute(
            select(SkuPlatformConfig).where(
                SkuPlatformConfig.platform_id == FLIPKART_PLATFORM_ID,
                SkuPlatformConfig.platform_sku_name.isnot(None),
            )
        )
        count = len(configs_count.scalars().all())
        print(f"OK SkuPlatformConfig rows for Flipkart: {count}")

    await engine.dispose()
    print("\nDone. Now delete and re-upload the report to trigger re-matching.")


if __name__ == "__main__":
    asyncio.run(main())
