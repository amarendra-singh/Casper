"""
P&L Service — Parse Flipkart P&L xlsx, match SKUs, store report.

Design principles:
- Dynamic column parsing (no hardcoded indices — Flipkart can change format)
- Snapshot Casper expected BS/profit% at upload time (financial accuracy)
- Store unmatched SKUs with sku_pricing_id=null (no silent data loss)
- Duplicate detection by platform + period
"""

from datetime import datetime, date
from typing import Optional, Tuple
import re
import openpyxl
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.pnl import PnlReport, PnlSkuRow
from app.models.sku import SkuPlatformConfig, SkuPricing
from app.models.platform import Platform
from app.schemas.pnl import PnlUploadResult, PnlDuplicateInfo


# ── Column header keywords for dynamic mapping ────────────────────────────────
# Each key maps to a list of substrings to search in header text (case-insensitive)
# First match wins. This handles minor Flipkart format variations.

SKU_COL_MAP = {
    "sku_id":                   ["sku id", "sku name"],
    "gross_units":              ["gross units"],
    "rto_units":                ["rto (logistics"],          # "RTO (Logistics Return)" — avoids matching "Returned & Cancelled"
    "rvp_units":                ["rvp (customer"],           # "RVP (Customer Return)"
    "cancelled_units":          ["cancellations"],           # Row 1: "Cancellations" (col 6) — not "Returned & Cancelled Units" (col 3)
    "net_units":                ["net units"],
    "accounted_net_sales":      ["accounted net sales"],
    "commission_fee":           ["commission fee"],
    "collection_fee":           ["collection fee"],
    "fixed_fee":                ["fixed fee"],               # Fixed Fee (col 15) — was missing
    "reverse_shipping_fee":     ["reverse shipping"],
    "taxes_gst":                ["taxes (gst)", "tax gst"],
    "taxes_tcs":                ["taxes (tcs)", "tax tcs"],
    "taxes_tds":                ["taxes (tds)", "tax tds"],
    "rewards_benefits":         ["rewards & other benefits", "rewards and other benefits"],
    # Flipkart uses square brackets: "Bank Settlement [Projected]"
    "bank_settlement_projected":["bank settlement [projected]", "bank settlement projected"],
    "input_tax_credits":        ["input tax credits (inr)", "input tax credit"],
    "net_earnings":             ["net earnings"],
    "earnings_per_unit":        ["earnings per unit"],
    "net_margin_pct":           ["net margins", "net margin"],
    "amount_settled":           ["amount settled"],
    "amount_pending":           ["amount pending"],
}

# Summary sheet row keywords → field names
SUMMARY_ROW_MAP = {
    "gross_sales":      ["gross sales"],
    "gross_units":      ["gross sales"],           # units in col C
    "returns_amount":   ["returns & cancellations", "returns and cancellations"],
    "returned_units":   ["returns & cancellations", "returns and cancellations"],
    "net_sales":        ["accounted net sales", "estimated net sales"],
    "net_units":        ["accounted net sales", "estimated net sales"],
    "total_expenses":   ["total expenses"],
    "bank_settlement":  ["bank settlement (projected)", "bank settlement projected"],
    "input_tax_credits":["input tax credit"],
    "net_earnings":     ["earnings on platform", "net earnings"],
    "net_margin_pct":   ["net margin"],
    "amount_settled":   ["already paid"],
    "amount_pending":   ["pending"],
}


def _safe_float(val) -> Optional[float]:
    """Convert cell value to float, handling None, strings with commas, ₹, % signs, dashes."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).replace(",", "").replace("₹", "").replace("%", "").strip()
    if s in ("", "-", "N/A", "NA"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _safe_int(val) -> Optional[int]:
    f = _safe_float(val)
    return int(f) if f is not None else None


def _safe_pct(val) -> Optional[float]:
    """
    Convert a percentage value to 0-100 scale.
    - String '80.71%' → 80.71
    - Excel decimal 0.8071 (openpyxl returns this for % formatted cells) → 80.71
    - Plain number 80.71 (Flipkart SKU sheet stores it this way) → 80.71
    Threshold: if abs(val) <= 1.0 treat as decimal; otherwise already 0-100 scale.
    """
    if val is None:
        return None
    if isinstance(val, str) and "%" in val:
        f = _safe_float(val)
        return round(f, 2) if f is not None else None
    f = _safe_float(val)
    if f is None:
        return None
    # Only multiply if it looks like a decimal fraction (e.g. 0.8071)
    if abs(f) <= 1.0:
        return round(f * 100, 2)
    return round(f, 2)


def _parse_date_str(s: str) -> Optional[date]:
    """Try multiple date formats Flipkart uses."""
    s = s.strip()
    for fmt in ("%Y-%m-%d", "%d %b %Y", "%d/%m/%Y", "%d-%m-%Y", "%b %d, %Y", "%d %B %Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _parse_period_from_summary(ws) -> Tuple[Optional[date], Optional[date]]:
    """
    Extract period_start and period_end from Sheet 1.
    Flipkart label: "Orders Recieved During:" (note: typo in Flipkart's report)
    Also handles: "Date Range", "Period", etc.
    Value format: "2026-03-01 to 2026-03-31" in col B.

    IMPORTANT: must specify max_col in iter_rows — openpyxl read_only mode
    only returns cells that have data in XML; without max_col sparse rows
    return only col A.
    """
    for row in ws.iter_rows(min_row=1, max_row=20, min_col=1, max_col=4, values_only=True):
        label = str(row[0] or "").lower().strip()
        # Match Flipkart's "Orders Recieved During:" and generic "Date Range"/"Period"
        if not any(k in label for k in ["during", "date range", "period start", "report period"]):
            continue

        # Col B might be a date object (openpyxl auto-detects) or a string
        val_b = row[1] if len(row) > 1 else None
        val_c = row[2] if len(row) > 2 else None

        # Case 1: openpyxl returned actual date objects
        if isinstance(val_b, date) and isinstance(val_c, date):
            return val_b, val_c

        # Case 2: string range "2026-03-01 to 2026-03-31" or "01 Mar 2026 - 31 Mar 2026"
        val_str = str(val_b or "").strip()
        for sep in [" to ", " - ", " – ", " ~ ", ","]:
            if sep in val_str:
                parts = val_str.split(sep, 1)
                d1 = _parse_date_str(parts[0].strip())
                d2 = _parse_date_str(parts[1].strip())
                if d1 and d2:
                    return d1, d2

        # Case 3: start date in col B, end date in col C (separate cells)
        if val_b and val_c:
            d1 = _parse_date_str(str(val_b).strip())
            d2 = _parse_date_str(str(val_c).strip())
            if d1 and d2:
                return d1, d2

    return None, None


def extract_period_from_bytes(file_bytes: bytes) -> Tuple[date, date]:
    """
    Lightweight — open workbook, read only Sheet 1 rows 1-20, extract period.
    Called before full parse to enable duplicate detection.
    Raises ValueError if period cannot be found.
    """
    from io import BytesIO
    wb = openpyxl.load_workbook(BytesIO(file_bytes), read_only=True, data_only=True)
    try:
        ws = wb[wb.sheetnames[0]]
        start, end = _parse_period_from_summary(ws)
    finally:
        wb.close()

    if not start or not end:
        raise ValueError(
            "Could not find the report period in Sheet 1. "
            "Make sure this is a Flipkart P&L report (Sheet 1 must have an 'Orders Recieved During:' row)."
        )
    return start, end


def _build_col_index(ws) -> dict[str, int]:
    """
    Read Sheet 2 headers (rows 1 and 2) and build field_name → col_index mapping.
    Uses iter_rows (compatible with read_only=True — ws.cell() is NOT available in read_only mode).
    Merges both header rows into one combined string per column for matching.
    """
    header_rows = []
    # max_col MUST be set — read_only mode only returns cells present in XML
    # (sparse rows appear as single-element). 60 covers all known Flipkart columns.
    for row in ws.iter_rows(min_row=1, max_row=2, min_col=1, max_col=60, values_only=True):
        header_rows.append([str(v or "").lower().strip() for v in row])

    if len(header_rows) < 2:
        return {}

    row1, row2 = header_rows[0], header_rows[1]
    max_cols = max(len(row1), len(row2))

    combined = []
    for i in range(max_cols):
        r1 = row1[i] if i < len(row1) else ""
        r2 = row2[i] if i < len(row2) else ""
        combined.append(f"{r1} {r2}".strip())

    mapping = {}
    for field, keywords in SKU_COL_MAP.items():
        for col_idx, header in enumerate(combined):
            if any(kw in header for kw in keywords):
                if field not in mapping:  # first match wins
                    mapping[field] = col_idx  # 0-indexed
    return mapping


def _parse_summary_sheet(ws) -> dict:
    """
    Parse Sheet 1 (Overall Summary).
    Format: Col A = label, Col B = amount INR, Col C = units.
    Searches for keyword rows rather than fixed row numbers.
    """
    data = {}
    # max_row AND max_col MUST be set — Flipkart xlsx has broken dimension attribute
    # (ws.max_row = 1 even though there are 60+ rows). max_row=200 covers all known layouts.
    for row in ws.iter_rows(min_row=1, max_row=200, min_col=1, max_col=4, values_only=True):
        label = str(row[0] or "").lower().strip()
        amount = _safe_float(row[1]) if len(row) > 1 else None
        units = _safe_int(row[2]) if len(row) > 2 else None

        if not label:
            continue

        if any(k in label for k in ["gross sales"]):
            data["gross_sales"] = amount
            data["gross_units"] = units

        elif any(k in label for k in ["returns & cancellations", "returns and cancellations"]):
            data["returns_amount"] = amount
            data["returned_units"] = abs(units) if units else None

        elif "accounted net sales" in label:
            data.setdefault("net_sales", amount)

        elif "estimated net sales" in label:
            data.setdefault("net_sales", amount)
            data.setdefault("net_units", units)

        elif "total expenses" in label:
            data["total_expenses"] = amount

        elif "bank settlement (projected)" in label or "bank settlement projected" in label:
            data["bank_settlement"] = amount

        elif "input tax credit" in label:
            data["input_tax_credits"] = amount

        elif "earnings on platform" in label:
            data["net_earnings"] = amount

        elif "net margin" in label:
            # Excel stores percentage cells as decimals: 80.71% → 0.8071
            data["net_margin_pct"] = _safe_pct(row[1])

        elif "already paid" in label:
            data["amount_settled"] = amount

        elif label.startswith("pending"):
            data["amount_pending"] = amount

    return data


def _parse_sku_sheet(ws, col_map: dict) -> list[dict]:
    """
    Parse Sheet 2 (SKU-level P&L). Data starts at row 3 (1-indexed).
    Returns list of raw dicts per SKU.
    """
    rows = []
    # max_row AND max_col MUST be set — Flipkart xlsx has broken dimension attribute (ws.max_row=1)
    # Use 10000 rows to handle any report size. Rows with no SKU name are skipped below.
    for row in ws.iter_rows(min_row=3, max_row=10000, min_col=1, max_col=60, values_only=True):
        sku_col = col_map.get("sku_id", 0)
        sku_name = str(row[sku_col] or "").strip() if len(row) > sku_col else ""
        if not sku_name or sku_name.lower() in ("sku id", "sku name", "total", ""):
            continue

        def get(field):
            idx = col_map.get(field)
            return row[idx] if idx is not None and idx < len(row) else None

        rows.append({
            "platform_sku_name":        sku_name,
            "gross_units":              _safe_int(get("gross_units")),
            "rto_units":                _safe_int(get("rto_units")),
            "rvp_units":                _safe_int(get("rvp_units")),
            "cancelled_units":          _safe_int(get("cancelled_units")),
            "net_units":                _safe_int(get("net_units")),
            "accounted_net_sales":      _safe_float(get("accounted_net_sales")),
            "commission_fee":           _safe_float(get("commission_fee")),
            "collection_fee":           _safe_float(get("collection_fee")),
            "fixed_fee":                _safe_float(get("fixed_fee")),
            "reverse_shipping_fee":     _safe_float(get("reverse_shipping_fee")),
            "taxes_gst":                _safe_float(get("taxes_gst")),
            "taxes_tcs":                _safe_float(get("taxes_tcs")),
            "taxes_tds":                _safe_float(get("taxes_tds")),
            "rewards_benefits":         _safe_float(get("rewards_benefits")),
            "bank_settlement_projected":_safe_float(get("bank_settlement_projected")),
            "input_tax_credits":        _safe_float(get("input_tax_credits")),
            "net_earnings":             _safe_float(get("net_earnings")),
            "earnings_per_unit":        _safe_float(get("earnings_per_unit")),
            "net_margin_pct":           _safe_pct(get("net_margin_pct")),
            "amount_settled":           _safe_float(get("amount_settled")),
            "amount_pending":           _safe_float(get("amount_pending")),
        })
    return rows


async def check_duplicate(
    session: AsyncSession,
    platform_id: int,
    period_start,
    period_end,
) -> Optional[PnlReport]:
    """Check if a report for this platform + period already exists."""
    result = await session.execute(
        select(PnlReport).where(
            PnlReport.platform_id == platform_id,
            PnlReport.period_start == period_start,
            PnlReport.period_end == period_end,
        )
    )
    return result.scalar_one_or_none()


# ── Helpers for parse_and_store ───────────────────────────────────────────────

# Flipkart "actuals" — fields copied verbatim from parsed row onto PnlSkuRow
_ACTUAL_FIELDS = (
    "gross_units", "rto_units", "rvp_units", "cancelled_units", "net_units",
    "accounted_net_sales", "commission_fee", "collection_fee", "fixed_fee",
    "reverse_shipping_fee", "taxes_gst", "taxes_tcs", "taxes_tds",
    "rewards_benefits", "bank_settlement_projected", "input_tax_credits",
    "net_earnings", "earnings_per_unit", "net_margin_pct",
    "amount_settled", "amount_pending",
)


def _parse_workbook(file_bytes: bytes) -> tuple[dict, list[dict]]:
    """Load workbook and parse both sheets. Returns (summary_dict, raw_sku_rows)."""
    from io import BytesIO
    wb = openpyxl.load_workbook(BytesIO(file_bytes), read_only=True, data_only=True)
    summary_ws = wb[wb.sheetnames[0]]
    sku_ws     = wb[wb.sheetnames[1]]
    summary      = _parse_summary_sheet(summary_ws)
    col_map      = _build_col_index(sku_ws)
    sku_rows_raw = _parse_sku_sheet(sku_ws, col_map)
    return summary, sku_rows_raw


async def _build_pricing_lookup(session: AsyncSession, platform_id: int) -> dict[str, SkuPricing]:
    """
    Build a case-insensitive map: platform_sku_name.upper() → SkuPricing.
    Used to match Flipkart SKU names against Casper pricing records.
    """
    config_result = await session.execute(
        select(SkuPlatformConfig).where(
            SkuPlatformConfig.platform_id == platform_id,
            SkuPlatformConfig.platform_sku_name.isnot(None),
        )
    )
    configs = config_result.scalars().all()

    pricing_ids = [c.sku_pricing_id for c in configs]
    if not pricing_ids:
        return {}

    pricing_result = await session.execute(
        select(SkuPricing).where(SkuPricing.id.in_(pricing_ids))
    )
    pricing_by_id = {sp.id: sp for sp in pricing_result.scalars().all()}

    return {
        cfg.platform_sku_name.strip().upper(): pricing_by_id[cfg.sku_pricing_id]
        for cfg in configs
        if cfg.platform_sku_name and cfg.sku_pricing_id in pricing_by_id
    }


def _build_report_model(summary: dict, platform_id: int, filename: str,
                        uploaded_by: int, period_start, period_end) -> PnlReport:
    """Instantiate a PnlReport from parsed summary sheet data."""
    return PnlReport(
        platform_id=platform_id,
        period_start=period_start,
        period_end=period_end,
        filename=filename,
        uploaded_by=uploaded_by,
        uploaded_at=datetime.utcnow(),
        status="done",
        gross_sales=summary.get("gross_sales"),
        gross_units=summary.get("gross_units"),
        returns_amount=summary.get("returns_amount"),
        returned_units=summary.get("returned_units"),
        net_sales=summary.get("net_sales"),
        net_units=summary.get("net_units"),
        total_expenses=summary.get("total_expenses"),
        bank_settlement=summary.get("bank_settlement"),
        input_tax_credits=summary.get("input_tax_credits"),
        net_earnings=summary.get("net_earnings"),
        net_margin_pct=summary.get("net_margin_pct"),
        amount_settled=summary.get("amount_settled"),
        amount_pending=summary.get("amount_pending"),
    )


def _build_sku_row(raw: dict, report_id: int, matched_pricing: Optional[SkuPricing]) -> PnlSkuRow:
    """
    Build a PnlSkuRow from parsed raw data + matched Casper pricing.
    If matched: computes variance vs Casper expected BS (snapshot at upload time).
    If unmatched: variance fields left null.
    """
    casper_fields: dict = dict(
        sku_pricing_id=None,
        casper_expected_bs=None,
        casper_expected_profit_pct=None,
        variance_bs=None,
        variance_margin_pct=None,
    )

    if matched_pricing is not None:
        sp           = matched_pricing
        actual_bs    = raw.get("bank_settlement_projected")
        net_units    = raw.get("net_units") or 0
        expected_bs  = sp.bank_settlement
        expected_tot = round(expected_bs * net_units, 2) if expected_bs else None
        variance_bs  = round(actual_bs - expected_tot, 2) if (actual_bs is not None and expected_tot is not None) else None

        actual_margin   = raw.get("net_margin_pct")
        expected_margin = sp.profit_percentage
        variance_margin = round(actual_margin - expected_margin, 2) if (actual_margin is not None and expected_margin) else None

        casper_fields = dict(
            sku_pricing_id=sp.id,
            casper_expected_bs=expected_bs,
            casper_expected_profit_pct=sp.profit_percentage,
            variance_bs=variance_bs,
            variance_margin_pct=variance_margin,
        )

    row = PnlSkuRow(
        report_id=report_id,
        platform_sku_name=raw["platform_sku_name"],
        **casper_fields,
    )
    for field in _ACTUAL_FIELDS:
        setattr(row, field, raw.get(field))
    return row


async def parse_and_store(
    session: AsyncSession,
    file_bytes: bytes,
    filename: str,
    platform_id: int,
    uploaded_by: int,
    period_start,
    period_end,
) -> PnlUploadResult:
    """
    Main entry point. Parse xlsx, match SKUs against Casper pricing, store report + rows.
    Returns upload result with match counts.
    """
    summary, sku_rows_raw = _parse_workbook(file_bytes)

    platform = await session.scalar(select(Platform).where(Platform.id == platform_id))
    platform_name = platform.name if platform else "Unknown"

    name_to_pricing = await _build_pricing_lookup(session, platform_id)

    report = _build_report_model(summary, platform_id, filename, uploaded_by, period_start, period_end)
    session.add(report)
    await session.flush()  # need report.id for child rows

    matched = unmatched = 0
    for raw in sku_rows_raw:
        sp = name_to_pricing.get(raw["platform_sku_name"].strip().upper())
        if sp is not None:
            matched += 1
        else:
            unmatched += 1
        session.add(_build_sku_row(raw, report.id, sp))

    await session.commit()

    return PnlUploadResult(
        report_id=report.id,
        platform_name=platform_name,
        period_start=period_start,
        period_end=period_end,
        total_skus=len(sku_rows_raw),
        matched_skus=matched,
        unmatched_skus=unmatched,
        duplicate=False,
    )


async def get_all_reports(session: AsyncSession, platform_id: Optional[int] = None) -> list[PnlReport]:
    """List all reports, optionally filtered by platform."""
    q = select(PnlReport).order_by(PnlReport.period_start.desc())
    if platform_id:
        q = q.where(PnlReport.platform_id == platform_id)
    result = await session.execute(q)
    return result.scalars().all()


async def get_report_detail(session: AsyncSession, report_id: int) -> Optional[PnlReport]:
    """Fetch full report, eagerly loading SKU rows + their live sku_pricing relationship."""
    from sqlalchemy.orm import selectinload
    result = await session.execute(
        select(PnlReport)
        .options(
            selectinload(PnlReport.sku_rows)
            .selectinload(PnlSkuRow.sku_pricing)
        )
        .where(PnlReport.id == report_id)
    )
    return result.scalar_one_or_none()


async def delete_report(session: AsyncSession, report_id: int) -> bool:
    """Delete report + all rows (cascade handles rows)."""
    result = await session.execute(select(PnlReport).where(PnlReport.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        return False
    await session.delete(report)
    await session.commit()
    return True
