"""
Billing / invoices service. build_billing_summary is a pure fn (unit-tested).
"""
from datetime import date
from collections import defaultdict
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.billing import Invoice
from app.services.scope import company_ids


def derive_status(stored: str, due, today: date) -> str:
    """'overdue' if unpaid/uncancelled and past due; else the stored status."""
    if stored in ("draft", "paid", "cancelled"):
        return stored
    if due and due < today:
        return "overdue"
    return stored


def build_billing_summary(rows: list[dict], today: date) -> dict:
    """
    rows: [{status, total, amount_paid, due_date}]
    Returns totals, per-status breakdown and an aging bucket for what's owed.
    Pure — no DB.
    """
    total_invoiced = total_paid = outstanding = overdue = 0.0
    by_status = defaultdict(lambda: {"count": 0, "total": 0.0})
    aging = {"0-30": 0.0, "31-60": 0.0, "60+": 0.0}

    for r in rows:
        stored = r["status"]
        if stored in ("draft", "cancelled"):
            by_status[stored]["count"] += 1
            by_status[stored]["total"] += r["total"]
            continue

        total_invoiced += r["total"]
        total_paid += r["amount_paid"]
        balance = round(r["total"] - r["amount_paid"], 2)

        payment_status = 'paid' if balance <= 0 else ('sent' if stored == 'paid' else stored)
        eff = derive_status(payment_status, r.get("due_date"), today)
        by_status[eff]["count"] += 1
        by_status[eff]["total"] += r["total"]

        if balance > 0:
            outstanding += balance
            if eff == "overdue":
                overdue += balance
                days = (today - r["due_date"]).days
                bucket = "0-30" if days <= 30 else ("31-60" if days <= 60 else "60+")
                aging[bucket] += balance

    return {
        "total_invoiced": round(total_invoiced, 2),
        "total_paid": round(total_paid, 2),
        "outstanding": round(outstanding, 2),
        "overdue": round(overdue, 2),
        "count": len([r for r in rows if r["status"] != "cancelled"]),
        "by_status": [
            {"status": s, "count": v["count"], "total": round(v["total"], 2)}
            for s, v in sorted(by_status.items())
        ],
        "aging": {k: round(v, 2) for k, v in aging.items()},
    }


def recalc_totals(invoice: Invoice) -> None:
    """Recompute subtotal / tax / total from the invoice's lines + gst_pct."""
    for ln in invoice.lines:
        ln.amount = round((ln.quantity or 0) * (ln.unit_price or 0), 2)
    invoice.subtotal = round(sum(ln.amount for ln in invoice.lines), 2)
    invoice.tax_amount = round(invoice.subtotal * (invoice.gst_pct or 0) / 100, 2)
    invoice.total = round(invoice.subtotal + invoice.tax_amount, 2)
    if invoice.amount_paid < 0 or invoice.amount_paid > invoice.total:
        raise ValueError("Amount paid must be between zero and the invoice total")
    if invoice.status != 'cancelled':
        if invoice.total > 0 and invoice.amount_paid == invoice.total:
            invoice.status = 'paid'
        elif invoice.status == 'paid':
            raise ValueError("A paid invoice must be fully paid")


async def next_invoice_number(db: AsyncSession, company_id: int) -> str:
    """Sequential per-company invoice number: INV-YYYY-NNNN."""
    year = date.today().year
    from app.models.billing import InvoiceSequence
    from sqlalchemy.dialects.sqlite import insert as sqlite_insert
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    numbers = (await db.scalars(select(Invoice.number).where(Invoice.company_id == company_id))).all()
    prefix = f"INV-{year}-"
    highest = max((int(n[len(prefix):]) for n in numbers if n.startswith(prefix) and n[len(prefix):].isdigit()), default=0)
    insert = pg_insert if db.bind.dialect.name == 'postgresql' else sqlite_insert
    stmt = insert(InvoiceSequence).values(company_id=company_id, year=year, last_number=highest + 1)
    stmt = stmt.on_conflict_do_update(index_elements=['company_id','year'],
        set_={'last_number': func.max(InvoiceSequence.last_number, highest) + 1} if db.bind.dialect.name == 'sqlite' else {'last_number': func.greatest(InvoiceSequence.last_number, highest) + 1}).returning(InvoiceSequence.last_number)
    number = await db.scalar(stmt)
    return f"INV-{year}-{number:04d}"



async def compute_billing_summary(db: AsyncSession, company_id: int | list[int]) -> dict:
    _cids = company_ids(company_id)
    result = await db.execute(
        select(Invoice.status, Invoice.total, Invoice.amount_paid, Invoice.due_date)
        .where(Invoice.company_id.in_(_cids))
    )
    rows = [{"status": s, "total": t, "amount_paid": p, "due_date": d} for s, t, p, d in result.all()]
    return build_billing_summary(rows, date.today())
