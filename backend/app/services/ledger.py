"""
Billing / expense ledger service.

`build_ledger_summary(rows)` is a pure function (no DB) — fully unit-tested.
`compute_ledger_summary(db, company_id, ...)` is the async DB wrapper.
"""
from collections import defaultdict
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ledger import LedgerEntry
from app.services.scope import company_ids
from app.models.vendor import Vendor
from app.models.sku import Sku


def build_ledger_summary(rows: list[dict]) -> dict:
    """
    rows: [{direction, category, amount}, ...]
    Returns totals + per-(category,direction) breakdown. Pure, no DB.
    """
    total_income = round(sum(r["amount"] for r in rows if r["direction"] == "income"), 2)
    total_expense = round(sum(r["amount"] for r in rows if r["direction"] == "expense"), 2)

    buckets = defaultdict(lambda: {"total": 0.0, "count": 0})
    for r in rows:
        key = (r["category"], r["direction"])
        buckets[key]["total"] += r["amount"]
        buckets[key]["count"] += 1

    by_category = [
        {"category": cat, "direction": direction,
         "total": round(v["total"], 2), "count": v["count"]}
        for (cat, direction), v in sorted(buckets.items(), key=lambda kv: -kv[1]["total"])
    ]

    return {
        "total_income": total_income,
        "total_expense": total_expense,
        "net": round(total_income - total_expense, 2),
        "count": len(rows),
        "by_category": by_category,
    }


async def compute_ledger_summary(db: AsyncSession, company_id: int | list[int],
                                 start=None, end=None, direction=None) -> dict:
    _cids = company_ids(company_id)
    conds = [LedgerEntry.company_id.in_(_cids)]
    if start:     conds.append(LedgerEntry.entry_date >= start)
    if end:       conds.append(LedgerEntry.entry_date <= end)
    if direction: conds.append(LedgerEntry.direction == direction)

    result = await db.execute(
        select(LedgerEntry.direction, LedgerEntry.category, LedgerEntry.amount).where(and_(*conds))
    )
    rows = [{"direction": d, "category": c, "amount": a} for d, c, a in result.all()]
    return build_ledger_summary(rows)


async def resolve_names(db: AsyncSession, company_id: int | list[int]) -> tuple[dict, dict]:
    """Return ({vendor_id: name}, {sku_id: shringar_sku}) for the company — for display."""
    _cids = company_ids(company_id)
    vrows = await db.execute(select(Vendor.id, Vendor.name).where(Vendor.company_id.in_(_cids)))
    srows = await db.execute(select(Sku.id, Sku.shringar_sku).where(Sku.company_id.in_(_cids)))
    return {i: n for i, n in vrows.all()}, {i: c for i, c in srows.all()}
