"""
P&L Statement engine — industry-standard contribution-margin income statement.

This is the single source of truth for report-level profit-and-loss math. It
follows the project's pure-function + DB-wrapper split:

  * build_pnl_statement(rows, report) -> dict   — PURE, fully unit-tested. All math.
  * build_pnl_trend(periods) -> dict            — PURE. Period-over-period series.
  * build_consolidated(statements) -> dict      — PURE. Blend across platforms.
  * compute_* (db, ...)                         — async wrappers: load rows, call pure fn.

Statement shape (contribution-margin format, top → bottom):

    Gross Sales
      (−) Returns / RTO
    = Net Sales ................................. revenue anchor for all margins
      (−) Marketplace Fees (commission, shipping, collection, fixed, GST-on-fees)
      (−) Marketing / Ads
    = Net Payout ................................ reconciles to actual bank settlement
      (−) COGS (product purchase cost)
    = Contribution Margin
      (−) Overhead absorption (fixed-cost allocation)
    = Operating / Net Profit

Margins are expressed as % of Net Sales (income-statement convention). This is a
DIFFERENT, correctly-labelled metric from the SKU-intelligence "real margin"
(return-on-cost) — the two are not interchangeable and must not be conflated.
"""
from __future__ import annotations

from typing import Optional


def _s(rows: list[dict], key: str) -> float:
    """Sum a field across rows, treating None as 0, magnitude-agnostic callers use abs()."""
    return sum((r.get(key) or 0) for r in rows)


def _abs_s(rows: list[dict], key: str) -> float:
    return sum(abs(r.get(key) or 0) for r in rows)


def _pct(part: float, whole: float) -> Optional[float]:
    return round(part / whole * 100, 2) if whole else None


def _round(x: Optional[float], n: int = 2) -> Optional[float]:
    return round(x, n) if x is not None else None


def build_pnl_statement(rows: list[dict], report: dict) -> dict:
    """
    Build a structured income statement from per-SKU rows + report totals.

    rows[i] keys (all optional/None-safe): net_units, gross_units,
      commission_fee, collection_fee, fixed_fee, reverse_shipping_fee, taxes_gst,
      bank_settlement_projected, cogs_per_unit, misc_per_unit, matched (bool).
    report keys: gross_sales, returns_amount, net_sales, marketing_fee,
      bank_settlement, tcs_amount, tds_amount, input_tax_credits.

    The statement always *foots*: an "Other fees" balancing line absorbs any gap
    between identified fee components and (Net Sales − Net Payout), so subtotals
    are internally consistent — a hard requirement for a real financial statement.
    """
    net_units   = int(_s(rows, "net_units"))
    gross_units = int(_s(rows, "gross_units"))

    # ── Revenue ──────────────────────────────────────────────────────────────
    gross_sales = report.get("gross_sales")
    returns     = -abs(report.get("returns_amount") or 0)
    net_sales   = report.get("net_sales")
    if net_sales is None:
        net_sales = (gross_sales or 0) + returns
    net_sales = net_sales or 0

    # ── Net Payout = the cash the platform actually wired (authoritative) ─────
    net_payout = _s(rows, "bank_settlement_projected")
    if not net_payout:
        net_payout = report.get("bank_settlement") or 0

    # ── Marketplace fees: identified components + a balancing plug ────────────
    commission = _abs_s(rows, "commission_fee")
    shipping   = _abs_s(rows, "reverse_shipping_fee")
    collection = _abs_s(rows, "collection_fee")
    fixed      = _abs_s(rows, "fixed_fee")
    gst_fees   = _abs_s(rows, "taxes_gst")
    marketing  = abs(report.get("marketing_fee") or 0)

    total_platform_fees = max(net_sales - net_payout, 0)
    identified = commission + shipping + collection + fixed + gst_fees + marketing
    other_fees = round(total_platform_fees - identified, 2)
    # Only surface "Other fees" as a positive plug; if identified overshoots (rare,
    # from rounding/rewards), fold the excess back so the statement still foots.
    if other_fees < 0:
        other_fees = 0.0
        total_platform_fees = identified

    # ── COGS + overhead from the cost model (matched SKUs only) ──────────────
    cogs     = _s(rows, "_cogs_total")       # cogs_per_unit × net_units, precomputed per row
    overhead = _s(rows, "_overhead_total")   # misc_per_unit × net_units

    # ── Subtotals ────────────────────────────────────────────────────────────
    gross_profit = net_sales - cogs
    contribution = net_payout - cogs
    operating    = contribution - overhead

    # ── Data quality: COGS coverage ──────────────────────────────────────────
    matched_units = int(_s([r for r in rows if r.get("matched")], "net_units"))
    coverage_pct  = _pct(matched_units, net_units)

    def line(key, label, amount, kind="expense", depth=1, note=None):
        return {"key": key, "label": label, "amount": _round(amount),
                "kind": kind, "depth": depth, "note": note}

    lines = [
        line("gross_sales", "Gross Sales", gross_sales, "revenue", 0),
        line("returns", "Returns & RTO", returns, "revenue", 1),
        line("net_sales", "Net Sales", net_sales, "subtotal", 0),
        line("commission", "Commission", -commission, "expense", 1),
        line("shipping", "Shipping & Reverse Logistics", -shipping, "expense", 1),
        line("collection", "Collection / Payment Fee", -collection, "expense", 1),
        line("fixed", "Fixed Fees", -fixed, "expense", 1),
        line("gst_fees", "GST on Fees", -gst_fees, "expense", 1),
        line("marketing", "Marketing / Ads", -marketing, "expense", 1),
        line("other_fees", "Other Marketplace Fees", -other_fees, "expense", 1),
        line("net_payout", "Net Payout", net_payout, "subtotal", 0,
             note="Reconciles to platform bank settlement"),
        line("cogs", "COGS (Product Cost)", -cogs, "expense", 1),
        line("contribution", "Contribution Margin", contribution, "subtotal", 0),
        line("overhead", "Overhead Absorption", -overhead, "expense", 1),
        line("operating_profit", "Operating / Net Profit", operating, "total", 0),
    ]

    return {
        "lines": [l for l in lines if not (l["kind"] == "expense" and (l["amount"] or 0) == 0)],
        "subtotals": {
            "gross_sales": _round(gross_sales),
            "net_sales": _round(net_sales),
            "total_platform_fees": _round(total_platform_fees),
            "net_payout": _round(net_payout),
            "cogs": _round(cogs),
            "gross_profit": _round(gross_profit),
            "contribution": _round(contribution),
            "overhead": _round(overhead),
            "operating_profit": _round(operating),
        },
        "margins": {
            "gross_margin_pct": _pct(gross_profit, net_sales),
            "contribution_margin_pct": _pct(contribution, net_sales),
            "operating_margin_pct": _pct(operating, net_sales),
            "take_rate_pct": _pct(total_platform_fees, net_sales),  # platform's cut
        },
        "units": {
            "gross_units": gross_units,
            "net_units": net_units,
            "returned_units": gross_units - net_units,
            "return_rate_pct": _pct(gross_units - net_units, gross_units),
        },
        "reconciliation": {
            "computed_net_payout": _round(net_payout),
            "actual_bank_settlement": _round(report.get("bank_settlement")),
            "variance": _round((report.get("bank_settlement") or net_payout) - net_payout),
        },
        "coverage": {
            "matched_units": matched_units,
            "total_units": net_units,
            "cogs_coverage_pct": coverage_pct,
            "reliable": (coverage_pct or 0) >= 70,  # < 70% COGS coverage → margins understated
        },
    }


def build_pnl_trend(periods: list[dict]) -> dict:
    """
    Period-over-period series from a list of per-period statement summaries.

    periods[i]: {period, platform, net_sales, net_payout, cogs, operating_profit,
                 operating_margin_pct, net_units}. Assumed already sorted ascending.
    """
    if not periods:
        return {"series": [], "latest": None, "delta": None}

    series = [{
        "period": p.get("period"),
        "platform": p.get("platform"),
        "net_sales": _round(p.get("net_sales")),
        "net_payout": _round(p.get("net_payout")),
        "operating_profit": _round(p.get("operating_profit")),
        "operating_margin_pct": p.get("operating_margin_pct"),
        "net_units": p.get("net_units"),
    } for p in periods]

    latest = series[-1]
    prev   = series[-2] if len(series) > 1 else None
    delta  = None
    if prev:
        def d(k):
            a, b = latest.get(k), prev.get(k)
            return _round((a or 0) - (b or 0)) if (a is not None or b is not None) else None
        delta = {
            "net_sales": d("net_sales"),
            "operating_profit": d("operating_profit"),
            "operating_margin_pct": d("operating_margin_pct"),
            "net_units": d("net_units"),
        }
    return {"series": series, "latest": latest, "delta": delta}


def build_consolidated(statements: list[dict]) -> dict:
    """Blend multiple platform statements into one business-wide P&L for a period."""
    if not statements:
        return {"subtotals": {}, "margins": {}, "platforms": []}

    keys = ["gross_sales", "net_sales", "total_platform_fees", "net_payout",
            "cogs", "gross_profit", "contribution", "overhead", "operating_profit"]
    agg = {k: round(sum((s["subtotals"].get(k) or 0) for s in statements), 2) for k in keys}
    ns = agg["net_sales"] or 0
    return {
        "subtotals": agg,
        "margins": {
            "gross_margin_pct": _pct(agg["gross_profit"], ns),
            "contribution_margin_pct": _pct(agg["contribution"], ns),
            "operating_margin_pct": _pct(agg["operating_profit"], ns),
            "take_rate_pct": _pct(agg["total_platform_fees"], ns),
        },
        "platforms": [{
            "platform": s.get("platform"),
            "net_sales": s["subtotals"].get("net_sales"),
            "operating_profit": s["subtotals"].get("operating_profit"),
            "operating_margin_pct": s["margins"].get("operating_margin_pct"),
        } for s in statements],
    }


# ── DB wrappers ──────────────────────────────────────────────────────────────

def _rows_and_report(report) -> tuple[list[dict], dict]:
    """Turn an eagerly-loaded PnlReport ORM object into (rows, report) dicts."""
    rows = []
    for r in report.sku_rows:
        sp = r.sku_pricing
        nu = r.net_units or 0
        rows.append({
            "net_units": nu,
            "gross_units": r.gross_units or 0,
            "bank_settlement_projected": r.bank_settlement_projected or 0,
            "commission_fee": r.commission_fee or 0,
            "reverse_shipping_fee": r.reverse_shipping_fee or 0,
            "collection_fee": r.collection_fee or 0,
            "fixed_fee": r.fixed_fee or 0,
            "taxes_gst": r.taxes_gst or 0,
            "matched": sp is not None,
            "_cogs_total": (sp.price if sp else 0) * nu,
            "_overhead_total": (sp.misc_total if sp else 0) * nu,
        })
    report_d = {
        "gross_sales": report.gross_sales,
        "returns_amount": report.returns_amount,
        "net_sales": report.net_sales,
        "marketing_fee": report.marketing_fee,
        "bank_settlement": report.bank_settlement,
        "tcs_amount": report.tcs_amount,
        "tds_amount": report.tds_amount,
        "input_tax_credits": report.input_tax_credits,
    }
    return rows, report_d


def _report_meta(report) -> dict:
    return {
        "id": report.id,
        "period_start": str(report.period_start),
        "period_end": str(report.period_end),
        "period": str(report.period_start)[:7],
        "platform": report.platform.name if report.platform else None,
        "filename": report.filename,
    }


def _statement_query():
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from app.models.pnl import PnlReport, PnlSkuRow
    return (select(PnlReport)
            .options(selectinload(PnlReport.sku_rows).selectinload(PnlSkuRow.sku_pricing),
                     selectinload(PnlReport.platform)))


async def compute_pnl_statement(db, report_id: int, company_id: int) -> Optional[dict]:
    """Full income statement for one report."""
    from app.models.pnl import PnlReport
    q = _statement_query().where(PnlReport.id == report_id, PnlReport.company_id == company_id)
    report = await db.scalar(q)
    if report is None:
        return None
    rows, report_d = _rows_and_report(report)
    stmt = build_pnl_statement(rows, report_d)
    stmt["report"] = _report_meta(report)
    return stmt


async def compute_pnl_trend(db, company_id: int, platform_id: Optional[int] = None) -> dict:
    """Period-over-period trend across a company's reports (optionally one platform)."""
    from app.models.pnl import PnlReport
    q = _statement_query().where(PnlReport.company_id == company_id).order_by(PnlReport.period_start)
    if platform_id:
        q = q.where(PnlReport.platform_id == platform_id)
    reports = (await db.execute(q)).scalars().all()

    periods = []
    for rep in reports:
        rows, report_d = _rows_and_report(rep)
        st = build_pnl_statement(rows, report_d)
        periods.append({
            "period": _report_meta(rep)["period"],
            "platform": rep.platform.name if rep.platform else None,
            "net_sales": st["subtotals"]["net_sales"],
            "net_payout": st["subtotals"]["net_payout"],
            "cogs": st["subtotals"]["cogs"],
            "operating_profit": st["subtotals"]["operating_profit"],
            "operating_margin_pct": st["margins"]["operating_margin_pct"],
            "net_units": st["units"]["net_units"],
        })
    return build_pnl_trend(periods)


async def compute_pnl_consolidated(db, company_id: int) -> dict:
    """Blended business-wide P&L — the latest report of each platform."""
    from app.models.pnl import PnlReport
    q = _statement_query().where(PnlReport.company_id == company_id).order_by(PnlReport.period_start.desc())
    reports = (await db.execute(q)).scalars().all()

    seen: set[int] = set()
    statements = []
    for rep in reports:
        if rep.platform_id in seen:
            continue
        seen.add(rep.platform_id)
        rows, report_d = _rows_and_report(rep)
        st = build_pnl_statement(rows, report_d)
        st["platform"] = rep.platform.name if rep.platform else None
        st["period"] = _report_meta(rep)["period"]
        statements.append(st)
    return build_consolidated(statements)
