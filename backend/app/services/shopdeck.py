"""
ShopDeck Report Parser
======================

ShopDeck (storefront e.g. tanmira.co) exports SEPARATE xlsx files per report
type — unlike Flipkart's single multi-sheet workbook. Its xlsx also ship a
malformed styles.xml + no sharedStrings, so openpyxl/pandas CANNOT read them.
This module parses the raw OOXML directly (inline strings), bypassing styles.

Returns the same (summary_dict, sku_rows_list) contract the P&L pipeline
expects, so ShopDeck plugs into parse_and_store() like any other platform.

Supported files (auto-detected):
  • Order Report (Revenue)  → PnlReport daily-aggregated summary.
  • Order Reconciliation    → per-order PnlSkuRow rows + derived summary.

Other ShopDeck reports (Shipping/Product Performance/Dispatched) are read by
the same reader but not yet mapped to the P&L model.
"""
from __future__ import annotations

import re
import zipfile
from datetime import date, datetime
from io import BytesIO
from typing import Optional
from xml.etree import ElementTree as ET

_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_NS = {"m": _MAIN}


# ── Raw OOXML reader (styles-independent) ───────────────────────────────────────

def _col_index(ref: str) -> int:
    letters = re.match(r"[A-Z]+", ref).group()
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def read_shopdeck_xlsx(file_bytes: bytes) -> dict[str, list[list]]:
    """Parse a (possibly malformed) ShopDeck xlsx → {sheet_name: [rows]}."""
    z = zipfile.ZipFile(BytesIO(file_bytes))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    relmap = {r.get("Id"): r.get("Target") for r in rels}
    rid_attr = f"{{{_REL}}}id"

    out: dict[str, list[list]] = {}
    for s in wb.find("m:sheets", _NS):
        name = s.get("name")
        tgt = relmap.get(s.get(rid_attr))
        if not tgt:
            continue
        tgt = tgt if tgt.startswith("xl/") else f"xl/{tgt}"
        try:
            root = ET.fromstring(z.read(tgt))
        except (KeyError, ET.ParseError):
            out[name] = []
            continue
        rows: list[list] = []
        data = root.find("m:sheetData", _NS)
        if data is None:
            out[name] = []
            continue
        for row in data.findall("m:row", _NS):
            cells: dict[int, str] = {}
            for c in row.findall("m:c", _NS):
                idx = _col_index(c.get("r"))
                if c.get("t") == "inlineStr":
                    is_ = c.find("m:is", _NS)
                    t = is_.find("m:t", _NS) if is_ is not None else None
                    cells[idx] = t.text if (t is not None and t.text) else ""
                else:
                    v = c.find("m:v", _NS)
                    cells[idx] = v.text if (v is not None and v.text) else ""
            if cells:
                mx = max(cells)
                rows.append([cells.get(i, "") for i in range(mx + 1)])
        out[name] = rows
    return out


# ── Helpers ─────────────────────────────────────────────────────────────────────

def _f(v) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(str(v).replace(",", "").replace("₹", "").strip())
    except ValueError:
        return None


def _i(v) -> Optional[int]:
    f = _f(v)
    return int(f) if f is not None else None


def _find_header_row(rows: list[list], must_have: str) -> int:
    """Index of the row whose cells contain `must_have` (case-insensitive)."""
    key = must_have.lower()
    for i, r in enumerate(rows):
        if any(key in str(c).lower() for c in r):
            return i
    return -1


def _col_map(header: list[str]) -> dict[str, int]:
    """Lower-cased header text → column index."""
    return {str(h).strip().lower(): i for i, h in enumerate(header) if str(h).strip()}


def _get(row: list, cmap: dict[str, int], *keys: str):
    """First non-empty cell whose header contains any of keys (substring match)."""
    for key in keys:
        kl = key.lower()
        for name, i in cmap.items():
            if kl in name and i < len(row):
                return row[i]
    return None


# ── Detection ───────────────────────────────────────────────────────────────────

def is_shopdeck(file_bytes: bytes) -> bool:
    """True if this looks like any ShopDeck export."""
    try:
        sheets = read_shopdeck_xlsx(file_bytes)
    except Exception:
        return False
    blob = " ".join(
        str(c).lower()
        for rows in sheets.values()
        for r in rows[:4]
        for c in r
    )
    return "shopdeck" in blob or "order report" in blob or "shipping performance" in blob \
        or "order reconciliation" in blob or "product performance" in blob


def _detect_kind(sheets: dict[str, list[list]]) -> str:
    names = " ".join(sheets.keys()).lower()
    head = " ".join(
        str(c).lower() for rows in sheets.values() for r in rows[:1] for c in r
    )
    if "reconciliation" in names or "reconciliation" in head:
        return "reconciliation"
    if "revenue" in names or "order report" in head:
        return "order_report"
    return "unknown"


# ── Period extraction ───────────────────────────────────────────────────────────

_DATE_RANGE_RE = re.compile(r"(\d{2})/(\d{2})/(\d{4})")


def extract_period_shopdeck(file_bytes: bytes) -> tuple[date, date]:
    """Read 'Date Range: dd/mm/yyyy [- dd/mm/yyyy]' from any ShopDeck sheet."""
    sheets = read_shopdeck_xlsx(file_bytes)
    found: list[date] = []
    for rows in sheets.values():
        for r in rows[:3]:
            for c in r:
                for m in _DATE_RANGE_RE.finditer(str(c)):
                    d, mth, y = map(int, m.groups())
                    try:
                        found.append(date(y, mth, d))
                    except ValueError:
                        pass
        if found:
            break
    if not found:
        today = date.today()
        return today, today
    return min(found), max(found)


# ── Order Report (Revenue) → summary ────────────────────────────────────────────

def _parse_order_report(sheets: dict[str, list[list]]) -> dict:
    """Daily revenue/fee rows → aggregated PnlReport summary."""
    rows = sheets.get("Revenue") or next(iter(sheets.values()), [])
    # Match on "Total Revenue" not "Date" — the "Date Range:" sub-title row also
    # contains "Date" and would be picked first.
    hdr_i = _find_header_row(rows, "Total Revenue")
    if hdr_i < 0:
        return {}
    cmap = _col_map(rows[hdr_i])
    data = rows[hdr_i + 1:]

    def col_sum(*keys: str) -> float:
        total = 0.0
        for r in data:
            v = _get(r, cmap, *keys)
            f = _f(v)
            if f is not None:
                total += f
        return round(total, 2)

    gross   = col_sum("total revenue")
    returns = col_sum("return revenue")
    net     = col_sum("delivered revenue")
    remit   = col_sum("net remittance")
    settled = col_sum("remitted amount")
    pending = col_sum("remittance pending")
    fees    = round(
        col_sum("shipping charge") + col_sum("marketing spend")
        + col_sum("shopdeck service fees") + col_sum("pg commision", "pg commission"), 2
    )
    return {
        "gross_sales": gross,
        "returns_amount": returns,
        "net_sales": net,
        "net_earnings": remit,
        "bank_settlement": remit,
        "amount_settled": settled,
        "amount_pending": pending,
        "marketing_fee": col_sum("marketing spend"),
        "commission_total": col_sum("pg commision", "pg commission"),
        "total_expenses": fees,
        "net_margin_pct": round(remit / gross * 100, 2) if gross else None,
    }


# ── Order Reconciliation → per-order sku_rows + summary ──────────────────────────

# ShopDeck order status → delivered/RTO/return flags
def _parse_reconciliation(sheets: dict[str, list[list]]) -> tuple[dict, list[dict]]:
    rows = sheets.get("Reconciliation") or next(iter(sheets.values()), [])
    hdr_i = _find_header_row(rows, "Order ID")
    if hdr_i < 0:
        return {}, []
    cmap = _col_map(rows[hdr_i])
    data = rows[hdr_i + 1:]

    sku_rows: list[dict] = []
    agg = {"gross": 0.0, "net": 0.0, "fees": 0.0, "units": 0, "rto": 0, "ret": 0}
    for r in data:
        sku = _get(r, cmap, "product code", "sku code")
        if not sku:
            continue
        qty = _i(_get(r, cmap, "quantity")) or 0
        value = _f(_get(r, cmap, "product value taxable")) or 0.0
        fee = _f(_get(r, cmap, "shopdeck service fees")) or 0.0
        cod_payable = _f(_get(r, cmap, "cod payable amount"))
        invoice = _f(_get(r, cmap, "invoice total"))
        status = str(_get(r, cmap, "order status") or "").lower()
        is_rto = "rto" in status
        is_ret = "return" in status
        payout = cod_payable if cod_payable is not None else (
            round((invoice or value) - fee, 2)
        )
        net_units = 0 if (is_rto or is_ret) else qty

        agg["gross"] += value
        agg["net"] += value if net_units else 0.0
        agg["fees"] += fee
        agg["units"] += qty
        agg["rto"] += qty if is_rto else 0
        agg["ret"] += qty if is_ret else 0

        sku_rows.append({
            "platform_sku_name": str(sku).strip(),
            "gross_units": qty,
            "rto_units": qty if is_rto else 0,
            "rvp_units": qty if is_ret else 0,
            "cancelled_units": 0,
            "net_units": net_units,
            "accounted_net_sales": round(value, 2),
            "commission_fee": round(fee, 2),
            "bank_settlement_projected": payout,
            "net_earnings": payout,
            "earnings_per_unit": round(payout / net_units, 2) if (payout is not None and net_units) else None,
        })

    summary = {
        "gross_sales": round(agg["gross"], 2),
        "net_sales": round(agg["net"], 2),
        "gross_units": agg["units"],
        "returned_units": agg["rto"] + agg["ret"],
        "return_orders": agg["rto"] + agg["ret"],
        "total_expenses": round(agg["fees"], 2),
    }
    return summary, sku_rows


# ── Public entry ────────────────────────────────────────────────────────────────

def parse_shopdeck(file_bytes: bytes) -> tuple[dict, list[dict]]:
    """Auto-detect ShopDeck file type → (summary, sku_rows)."""
    sheets = read_shopdeck_xlsx(file_bytes)
    kind = _detect_kind(sheets)
    if kind == "reconciliation":
        return _parse_reconciliation(sheets)
    if kind == "order_report":
        return _parse_order_report(sheets), []
    return {}, []


# ── Product Performance → per-SKU RTO%/return% ──────────────────────────────────

def parse_product_performance(file_bytes: bytes) -> list[dict]:
    """Per-product sales + RTO% + return% (analysis enrichment)."""
    sheets = read_shopdeck_xlsx(file_bytes)
    rows = sheets.get("Product Performance") or next(iter(sheets.values()), [])
    hdr_i = _find_header_row(rows, "Product Code")
    if hdr_i < 0:
        return []
    cmap = _col_map(rows[hdr_i])
    out = []
    for r in rows[hdr_i + 1:]:
        code = _get(r, cmap, "product code")
        if not code:
            continue
        out.append({
            "sku": str(code).strip(),
            "name": str(_get(r, cmap, "product name") or "").strip(),
            "overall_sales": _i(_get(r, cmap, "overall sales")) or 0,
            "rto_pct": _f(_get(r, cmap, "overall rto")) or 0.0,
            "return_pct": _f(_get(r, cmap, "return requests")) or 0.0,
        })
    return out


# ── Cashflow PDF → settlement cash summary ──────────────────────────────────────

_NUM_RE = re.compile(r"-?[\d,]+\.\d{2}$")


def _parse_cashflow_text(text: str) -> dict:
    """Pure: walk a ShopDeck cashflow PDF's label→value lines into a dict."""
    lines = [ln.replace("\t", " ").strip() for ln in text.splitlines() if ln.strip()]
    pairs: dict[str, float] = {}
    label_parts: list[str] = []
    for ln in lines:
        if _NUM_RE.fullmatch(ln):
            label = " ".join(label_parts).strip().lower()
            if label and label not in pairs:        # keep first occurrence
                pairs[label] = float(ln.replace(",", ""))
            label_parts = []
        else:
            label_parts.append(ln)

    def pick(*keys: str):
        for k in keys:
            for lbl, val in pairs.items():
                if k in lbl:
                    return val
        return None

    period = None
    m = re.search(r"(\d{2}/\d{2}/\d{4}).*?(\d{2}/\d{2}/\d{4})", text)
    if m:
        def d(s):
            dd, mm, yy = map(int, s.split("/"))
            return date(yy, mm, dd)
        try:
            period = (d(m.group(1)), d(m.group(2)))
        except ValueError:
            period = None

    return {
        "period": period,
        "net_received": pick("net received"),
        "shipping_charge": pick("shipping charge"),
        "marketing_spend": pick("marketing spend"),
        "service_fees": pick("service fees"),
        "returned_amount": pick("returned orders amount"),
        "pg_remittance": pick("pg remittance"),
        "raw": pairs,
    }


def parse_cashflow_pdf(file_bytes: bytes) -> dict:
    """Extract the ShopDeck Cashflow PDF → settlement cash summary."""
    from pypdf import PdfReader
    reader = PdfReader(BytesIO(file_bytes))
    text = "\n".join((p.extract_text() or "") for p in reader.pages)
    return _parse_cashflow_text(text)


# ── Shipping Performance → daily funnel summary ─────────────────────────────────

def parse_shipping_performance(file_bytes: bytes) -> dict:
    """Aggregate the daily shipping funnel into totals."""
    sheets = read_shopdeck_xlsx(file_bytes)
    rows = sheets.get("Absolute") or next(iter(sheets.values()), [])
    hdr_i = _find_header_row(rows, "Total Orders")
    if hdr_i < 0:
        return {}
    cmap = _col_map(rows[hdr_i])
    data = rows[hdr_i + 1:]

    def col_sum(*keys: str) -> int:
        return int(sum((_i(_get(r, cmap, *keys)) or 0) for r in data))

    total = col_sum("total orders")
    rto = col_sum("rto")
    delivered = col_sum("delivered")
    returns = col_sum("return items")
    return {
        "total_orders": total,
        "confirmed": col_sum("confirmed orders"),
        "intransit": col_sum("intransit"),
        "rto": rto,
        "delivered": delivered,
        "lost": col_sum("lost"),
        "returns": returns,
        "rto_pct": round(rto / total * 100, 1) if total else None,
        "delivery_pct": round(delivered / total * 100, 1) if total else None,
    }
