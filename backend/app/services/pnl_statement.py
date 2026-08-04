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
    # TCS/TDS are withholding taxes, not marketplace fees — they are creditable
    # (TCS against GST liability, TDS against income tax) so they get their own
    # lines rather than disappearing into the balancing plug.
    tcs = _abs_s(rows, "taxes_tcs") or abs(report.get("tcs_amount") or 0)
    tds = _abs_s(rows, "taxes_tds") or abs(report.get("tds_amount") or 0)

    total_platform_fees = max(net_sales - net_payout, 0)
    identified = commission + shipping + collection + fixed + gst_fees + marketing + tcs + tds
    other_fees = round(total_platform_fees - identified, 2)
    # Only surface "Other fees" as a positive plug; if identified overshoots (rare,
    # from rounding/rewards), fold the excess back so the statement still foots.
    if other_fees < 0:
        other_fees = 0.0
        total_platform_fees = identified

    # ── Full cost stack from the cost model (matched SKUs only) ──────────────
    # Together these equal breakeven × net_units — the complete per-unit cost floor.
    cogs        = _s(rows, "_cogs_total")         # product purchase cost (price × units)
    fulfillment = _s(rows, "_fulfillment_total")  # (package + logistics + addons) × units
    return_cost = _s(rows, "_return_total")       # (courier-return + damage provision) × units
    overhead    = _s(rows, "_overhead_total")     # misc / fixed-cost allocation × units
    total_cost  = cogs + fulfillment + return_cost + overhead

    # Payout earned by SKUs we have NO cost for. Counting their revenue while
    # counting nobody's cost would inflate profit, so it is removed on its own
    # line — revenue and cost must always cover the same set of SKUs.
    uncosted_payout = round(_s([r for r in rows if not r.get("matched")],
                               "bank_settlement_projected"), 2)
    costed_payout = net_payout - uncosted_payout

    # ── Subtotals ────────────────────────────────────────────────────────────
    gross_profit = net_sales - cogs                                  # revenue-anchored indicator
    contribution = costed_payout - cogs - fulfillment - return_cost  # after variable costs
    operating    = contribution - overhead                           # == costed_payout − total_cost

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
        line("tcs", "TCS (Tax Collected at Source)", -tcs, "expense", 1,
             note="Creditable against GST liability"),
        line("tds", "TDS (Tax Deducted at Source)", -tds, "expense", 1,
             note="Creditable against income tax"),
        line("marketing", "Marketing / Ads", -marketing, "expense", 1),
        line("other_fees", "Other Marketplace Fees", -other_fees, "expense", 1),
        line("net_payout", "Net Payout", net_payout, "subtotal", 0,
             note="Reconciles to platform bank settlement"),
        line("uncosted_payout", "Less: SKUs with no cost data", -uncosted_payout, "expense", 1,
             note="Excluded so revenue and cost cover the same SKUs"),
        line("costed_payout", "Costed Net Payout", costed_payout, "subtotal", 0),
        line("cogs", "COGS (Product Cost)", -cogs, "expense", 1),
        line("fulfillment", "Fulfillment (Packaging, Logistics)", -fulfillment, "expense", 1),
        line("return_cost", "Return Cost (Courier + Damage)", -return_cost, "expense", 1),
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
            "uncosted_payout": _round(uncosted_payout),
            "costed_payout": _round(costed_payout),
            "tcs": _round(tcs),
            "tds": _round(tds),
            "cogs": _round(cogs),
            "fulfillment": _round(fulfillment),
            "return_cost": _round(return_cost),
            "overhead": _round(overhead),
            "total_cost": _round(total_cost),
            "gross_profit": _round(gross_profit),
            "contribution": _round(contribution),
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
            # "frozen" = costs snapshotted at upload (report is immutable);
            # "estimated" = uploaded before snapshots existed, so costs come from
            # today's live pricing and this report can move if pricing is edited.
            "cost_basis": "frozen" if all(r.get("_frozen") for r in rows if r.get("matched")) and rows
                          else "estimated",
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
            "cogs", "fulfillment", "return_cost", "overhead", "total_cost",
            "gross_profit", "contribution", "operating_profit"]
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

def _cost_basis(row) -> tuple[dict, bool]:
    """
    Per-unit cost basis for one SKU row, and whether it is frozen.

    Prefers the snapshot captured at upload (`snap_*`) so a closed period's profit
    never moves when SKU pricing is edited later. Falls back to live `sku_pricing`
    for rows uploaded before snapshots existed — those are reported as "estimated".

    This is the ONLY place that decides frozen-vs-live; both the statement engine
    and the per-SKU rows engine call it, so the two can never diverge.
    """
    if row.snap_breakeven is not None:
        return {
            "cogs": row.snap_cogs_per_unit or 0,
            "fulfillment": row.snap_fulfillment_per_unit or 0,
            "return_cost": row.snap_return_per_unit or 0,
            "overhead": row.snap_overhead_per_unit or 0,
            "breakeven": row.snap_breakeven,
            "gst": row.snap_gst or 0,
        }, True

    sp = row.sku_pricing
    if sp is None:
        return {"cogs": 0, "fulfillment": 0, "return_cost": 0,
                "overhead": 0, "breakeven": None, "gst": 0}, False
    return {
        "cogs": sp.price or 0,
        "fulfillment": (sp.package or 0) + (sp.logistics or 0) + (sp.addons or 0),
        "return_cost": (sp.cr_cost or 0) + (sp.damage_cost or 0),
        "overhead": sp.misc_total or 0,
        "breakeven": sp.breakeven,
        "gst": sp.gst or 0,
    }, False


def _rows_and_report(report) -> tuple[list[dict], dict]:
    """Turn an eagerly-loaded PnlReport ORM object into (rows, report) dicts."""
    rows = []
    for r in report.sku_rows:
        matched = r.sku_pricing is not None or r.snap_breakeven is not None
        cb, frozen = _cost_basis(r)
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
            "taxes_tcs": r.taxes_tcs or 0,
            "taxes_tds": r.taxes_tds or 0,
            "matched": matched,
            "_frozen": frozen,
            "_cogs_total": cb["cogs"] * nu,
            "_fulfillment_total": cb["fulfillment"] * nu,
            "_return_total": cb["return_cost"] * nu,
            "_overhead_total": cb["overhead"] * nu,
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


def build_pnl_rows(rows: list[dict]) -> dict:
    """
    Per-SKU P&L reconciliation rows — the math behind the P&L table, on the
    backend (single source of truth). For every displayed number it also returns
    a `calc` breakdown: {ops: [[label, value], ...], result} so the UI can show
    exactly how each figure was derived on hover.

    Each input row: platform_sku_name, id, gross_units, net_units,
      bank_settlement_projected, commission_fee, collection_fee, fixed_fee,
      taxes_gst, taxes_tcs, taxes_tds, rewards_benefits, price, package,
      logistics, addons, misc_total, cr_cost, damage_cost, breakeven,
      breakeven_gst, target_pre_gst, target_post_gst.
    """
    out = []
    tot_exp = tot_act = tot_profit = tot_units = 0.0
    wpn = wcn = wpg = wcg = 0.0   # weighted profit/cost, no-gst and gst
    profit_u_sum = 0.0
    n = 0

    for r in rows:
        nu = r.get("net_units") or 0
        gu = r.get("gross_units") or 0
        be = r.get("breakeven")
        beg = r.get("breakeven_gst")
        bsp = r.get("bank_settlement_projected")

        payout_u = (bsp / nu) if (bsp is not None and nu) else None
        fee_sum = (abs(r.get("commission_fee") or 0) + abs(r.get("collection_fee") or 0)
                   + abs(r.get("fixed_fee") or 0) + abs(r.get("taxes_gst") or 0)
                   + abs(r.get("taxes_tcs") or 0) + abs(r.get("taxes_tds") or 0)
                   - abs(r.get("rewards_benefits") or 0))
        fees_u = (fee_sum / nu) if nu else None
        exp_total = (be * nu) if be is not None else None
        profit_u = (payout_u - be) if (payout_u is not None and be is not None) else None
        total_profit = (bsp - exp_total) if (bsp is not None and exp_total is not None) else None
        margin = (profit_u / be * 100) if (profit_u is not None and be) else None
        profit_u_gst = (payout_u - beg) if (payout_u is not None and beg is not None) else None
        margin_gst = (profit_u_gst / beg * 100) if (profit_u_gst is not None and beg) else None
        ret_rate = ((gu - nu) / gu * 100) if gu else None

        # ops = [label, value, kind]; kind: 'money' (default), 'n' (count), None (no value)
        calc = {
            "return_rate_pct": {"unit": "pct", "result": ret_rate, "ops": [
                ["Returned units", gu - nu, "n"], ["÷ Gross units", gu, "n"], ["× 100", None, None]]},
            "casper_breakeven": {"unit": "money", "result": be, "ops": r.get("cost_ops") or [
                ["Product cost", r.get("price"), "money"], ["+ Packaging", r.get("package"), "money"],
                ["+ Logistics", r.get("logistics"), "money"], ["+ Add-ons", r.get("addons"), "money"],
                ["+ Overhead", r.get("misc_total"), "money"], ["+ Return cost", r.get("cr_cost"), "money"],
                ["+ Damage", r.get("damage_cost"), "money"]]},
            "fees_per_unit": {"unit": "money", "result": fees_u, "ops": [
                ["Commission + fees + taxes", fee_sum, "money"], ["÷ Units sold", nu, "n"]]},
            "total_earned": {"unit": "money", "result": bsp, "ops": [
                ["Platform bank settlement", bsp, "money"]]},
            "fk_bs_per_unit": {"unit": "money", "result": payout_u, "ops": [
                ["Net Payout", bsp, "money"], ["÷ Units sold", nu, "n"]]},
            "profit_no_gst": {"unit": "money", "result": profit_u, "ops": [
                ["Payout / unit", payout_u, "money"], ["− Breakeven / unit", be, "money"]]},
            "expected_total": {"unit": "money", "result": exp_total, "ops": [
                ["Breakeven / unit", be, "money"], ["× Units sold", nu, "n"]]},
            "total_true_profit": {"unit": "money", "result": total_profit, "ops": [
                ["Net Payout", bsp, "money"], ["− Total Cost", exp_total, "money"]]},
            "real_margin_pct": {"unit": "pct", "result": margin, "ops": [
                ["Profit / unit", profit_u, "money"], ["÷ Breakeven / unit", be, "money"], ["× 100", None, None]]},
            "margin_gst_pct": {"unit": "pct", "result": margin_gst, "ops": [
                ["Profit / unit", profit_u_gst, "money"], ["÷ Breakeven + GST", beg, "money"], ["× 100", None, None]]},
        }

        out.append({
            "id": r.get("id"),
            "platform_sku_name": r.get("platform_sku_name"),
            "gross_units": gu,
            "net_units": nu,
            "return_rate_pct": _round(ret_rate),
            "casper_breakeven": _round(be),
            "casper_breakeven_gst": _round(beg),
            "casper_target_pre_gst": _round(r.get("target_pre_gst")),
            "casper_target_post_gst": _round(r.get("target_post_gst")),
            "fees_per_unit": _round(fees_u),
            "total_earned": _round(bsp),
            "fk_bs_per_unit": _round(payout_u),
            "profit_no_gst": _round(profit_u),
            "expected_total": _round(exp_total),
            "total_true_profit": _round(total_profit),
            "real_margin_pct": _round(margin),
            "margin_gst_pct": _round(margin_gst),
            "calc": calc,
        })

        if exp_total is not None:
            tot_exp += exp_total
            if bsp is not None:
                tot_act += bsp
            if total_profit is not None:
                tot_profit += total_profit
        tot_units += nu
        if profit_u is not None and be is not None:
            wpn += profit_u * nu; wcn += be * nu
        if profit_u_gst is not None and beg is not None:
            wpg += profit_u_gst * nu; wcg += beg * nu
        if profit_u is not None:
            profit_u_sum += profit_u; n += 1

    summary = {
        "total_expected": _round(tot_exp),
        "total_actual": _round(tot_act),
        "total_profit": _round(tot_profit),
        "total_units": int(tot_units),
        "overall_var_pct": _pct(tot_act - tot_exp, tot_exp),
        "avg_profit_per_unit": _round(profit_u_sum / n) if n else None,
        "weighted_margin_pct": _pct(wpn, wcn),
        "weighted_margin_gst_pct": _pct(wpg, wcg),
        "profitable": sum(1 for r in out if (r["total_true_profit"] or 0) > 0),
        "loss_making": sum(1 for r in out if (r["total_true_profit"] or 0) <= 0),
    }
    return {"rows": out, "summary": summary}


async def compute_pnl_rows(db, report_id: int, company_id: int) -> Optional[dict]:
    """Per-SKU P&L rows (matched SKUs) with calc breakdowns — backend single source of truth."""
    from app.models.pnl import PnlReport
    q = _statement_query().where(PnlReport.id == report_id, PnlReport.company_id == company_id)
    report = await db.scalar(q)
    if report is None:
        return None
    raw = []
    all_frozen = True
    for r in report.sku_rows:
        sp = r.sku_pricing
        cb, frozen = _cost_basis(r)
        if cb["breakeven"] is None:
            continue  # matched rows only (needs a cost basis)
        if not frozen:
            all_frozen = False
        breakeven = cb["breakeven"]
        breakeven_gst = round(breakeven + cb["gst"], 2)
        # Cost components for the breakeven hover popover. A frozen row only stored
        # aggregates, so it explains itself at that granularity; a live row can show
        # the full granular stack.
        if frozen:
            cost_ops = [
                ["Product cost", cb["cogs"], "money"],
                ["+ Fulfillment", cb["fulfillment"], "money"],
                ["+ Return cost", cb["return_cost"], "money"],
                ["+ Overhead", cb["overhead"], "money"],
            ]
        else:
            cost_ops = [
                ["Product cost", sp.price, "money"], ["+ Packaging", sp.package, "money"],
                ["+ Logistics", sp.logistics, "money"], ["+ Add-ons", sp.addons, "money"],
                ["+ Overhead", sp.misc_total, "money"], ["+ Return cost", sp.cr_cost, "money"],
                ["+ Damage", sp.damage_cost, "money"],
            ]
        raw.append({
            "id": r.id, "platform_sku_name": r.platform_sku_name,
            "gross_units": r.gross_units, "net_units": r.net_units,
            "bank_settlement_projected": r.bank_settlement_projected,
            "commission_fee": r.commission_fee, "collection_fee": r.collection_fee,
            "fixed_fee": r.fixed_fee, "taxes_gst": r.taxes_gst,
            "taxes_tcs": r.taxes_tcs, "taxes_tds": r.taxes_tds,
            "rewards_benefits": r.rewards_benefits,
            "breakeven": breakeven, "breakeven_gst": breakeven_gst,
            "cost_ops": cost_ops,
            "target_pre_gst": round(breakeven + (sp.net_profit_amt or 0), 2) if sp else None,
            "target_post_gst": sp.bank_settlement if sp else None,
        })
    result = build_pnl_rows(raw)
    result["report"] = _report_meta(report)
    result["cost_basis"] = "frozen" if (all_frozen and raw) else "estimated"
    return result


async def compute_unmatched_skus(db, company_id: int) -> list[dict]:
    """
    Distinct platform SKU names seen in uploads that have NO cost match in the
    SKU master (sku_pricing_id IS NULL) — the 'hidden' SKUs excluded from P&L.
    Aggregated so the user can prioritise which to add (by volume / payout).
    """
    from sqlalchemy import select, func
    from app.models.pnl import PnlSkuRow
    q = (select(
            PnlSkuRow.platform_sku_name,
            func.count(func.distinct(PnlSkuRow.report_id)).label("reports"),
            func.coalesce(func.sum(PnlSkuRow.net_units), 0).label("units"),
            func.coalesce(func.sum(PnlSkuRow.bank_settlement_projected), 0).label("payout"),
         )
         .where(PnlSkuRow.company_id == company_id, PnlSkuRow.sku_pricing_id.is_(None))
         .group_by(PnlSkuRow.platform_sku_name)
         .order_by(func.coalesce(func.sum(PnlSkuRow.net_units), 0).desc()))
    rows = (await db.execute(q)).all()
    return [{
        "platform_sku_name": r.platform_sku_name,
        "reports": r.reports,
        "units": int(r.units or 0),
        "payout": round(r.payout or 0, 2),
    } for r in rows]


def select_consolidation_period(index: dict[str, set]) -> tuple[Optional[str], list]:
    """
    Choose the period to consolidate on, given {period: {platform_id, ...}}.

    Prefers the latest period covered by EVERY platform that has any report —
    summing a Flipkart May report with a Meesho June report would misstate the
    business. If no period is common to all, falls back to the latest period and
    reports the platforms missing from it, so the UI can disclose the gap rather
    than silently mismatch.
    """
    if not index:
        return None, []
    all_platforms = set().union(*index.values())
    complete = [p for p, plats in index.items() if plats == all_platforms]
    period = max(complete) if complete else max(index)
    return period, sorted(all_platforms - index[period])


async def compute_pnl_consolidated(db, company_id: int) -> dict:
    """
    Blended business-wide P&L for a single aligned period across platforms.

    Uses the latest report per platform *within that period* so the consolidation
    is period-comparable.
    """
    from app.models.pnl import PnlReport
    q = _statement_query().where(PnlReport.company_id == company_id).order_by(PnlReport.period_start.desc())
    reports = (await db.execute(q)).scalars().all()

    index: dict[str, set] = {}
    for rep in reports:
        index.setdefault(_report_meta(rep)["period"], set()).add(rep.platform_id)
    period, missing_ids = select_consolidation_period(index)

    id_to_name = {rep.platform_id: (rep.platform.name if rep.platform else None) for rep in reports}
    seen: set[int] = set()
    statements = []
    for rep in reports:                      # already newest-first
        if _report_meta(rep)["period"] != period or rep.platform_id in seen:
            continue
        seen.add(rep.platform_id)
        rows, report_d = _rows_and_report(rep)
        st = build_pnl_statement(rows, report_d)
        st["platform"] = rep.platform.name if rep.platform else None
        st["period"] = period
        statements.append(st)

    result = build_consolidated(statements)
    result["period"] = period
    result["excluded_platforms"] = [id_to_name.get(pid) for pid in missing_ids]
    return result
