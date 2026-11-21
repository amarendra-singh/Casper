"""
Bill-discrepancy parsing: a Flipkart order export (CSV) and a Vyapar party
statement (PDF) side by side.

The two documents are opposite sides of the business — Flipkart is what was
SOLD to customers, the Vyapar statement is what was BOUGHT from a supplier —
and they share no common key. So nothing here infers a relationship between
them. It parses each into facts and flags what could not be matched, leaving
the judgement to a human.

Pure functions (`parse_flipkart_csv`, `parse_vyapar_pdf_text`, `build_report`)
hold all the logic; the route only does I/O.
"""
import csv
import io
import re
from typing import Optional

# A Vyapar transaction header: date, type, ref no, payment status, total.
_TXN = re.compile(
    r"(\d{2}/\d{2}/\d{4})\s+(Sale|Purchase|Payment-In|Payment-Out|Credit Note|Debit Note)\s+"
    r"(\S+)\s+(Unpaid|Paid|Partial)\s+₹\s*([\d,]+\.\d{2})"
)
# A line item always terminates with "₹ price ₹ amount". Total / Sub Total
# rows carry a single ₹, so they never match and fall out on their own.
_ITEM = re.compile(r"₹\s*([\d,]+\.\d{2})\s*₹\s*([\d,]+\.\d{2})")


def _num(value) -> Optional[float]:
    if value is None:
        return None
    s = str(value).replace(",", "").replace("₹", "").strip()
    if s in ("", "NA", "-", "--"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse_flipkart_csv(text: str) -> list[dict]:
    """Flipkart order export → one row per order item."""
    out = []
    for r in csv.DictReader(io.StringIO(text)):
        order_id = (r.get("Order Id") or "").strip()
        if not order_id:
            continue
        out.append({
            "order_id":       order_id,
            "ordered_on":     (r.get("Ordered On") or "").strip(),
            "sku":            (r.get("SKU") or "").strip(),
            "product":        (r.get("Product") or "").strip(),
            "invoice_no":     (r.get("Invoice No.") or "").strip(),
            "invoice_date":   (r.get("Invoice Date (mm/dd/yy)") or "").strip(),
            "invoice_amount": _num(r.get("Invoice Amount")),
            "selling_price":  _num(r.get("Selling Price Per Item")),
            "quantity":       int(_num(r.get("Quantity")) or 0),
            "state":          (r.get("Order State") or "").strip(),
            "hsn":            (r.get("HSN CODE") or "").strip(),
        })
    return out


def detect_supplier(text: str) -> Optional[str]:
    """
    The business that issued the statement — Vyapar prints it as the first
    non-empty line, above "Party statement".
    """
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        if re.match(r"(party|phone|duration|date)\b", line, re.I):
            return None
        return line
    return None


def parse_vyapar_pdf_text(text: str) -> list[dict]:
    """Vyapar party statement text → one entry per transaction, with line items."""
    heads = list(_TXN.finditer(text))
    bills: list[dict] = []
    for i, m in enumerate(heads):
        block = text[m.end(): heads[i + 1].start() if i + 1 < len(heads) else len(text)]
        items: list[dict] = []
        prev_end = 0
        for im in _ITEM.finditer(block):
            head = block[prev_end:im.start()]
            prev_end = im.end()
            # Keep only what follows the item-table header. Taking the text
            # *after* it (rather than deleting just the header) also discards the
            # statement's column header, which Vyapar reprints at a page break
            # and which would otherwise be read as the first item's name.
            hdr = None
            for hdr in re.finditer(r"#\s*Item name.*?Amount", head, flags=re.S):
                pass
            if hdr:
                head = head[hdr.end():]
            head = re.sub(r"\b(Sub Total|Total)\b[^\n]*", " ", head)
            # The txn header trails Received / Txn Balance / Receivable figures,
            # and they land in front of the first item. An item name never
            # contains a ₹ amount, so drop any that leaked in.
            head = re.sub(r"₹\s*[\d,]+\.\d{2}", " ", head)
            head = " ".join(head.split())
            qty = None
            unit = None
            qm = re.search(r"(\d+(?:\.\d+)?)\s*(Pcs|PCS|pieces?|box|set|-)?$", head)
            if qm:
                qty = _num(qm.group(1))
                raw_unit = (qm.group(2) or "").lower()
                unit = "piece" if raw_unit in {"pcs", "piece", "pieces"} else raw_unit if raw_unit in {"box", "set"} else None
                head = head[: qm.start()]
            name = re.sub(r"^\d+\s+", "", " ".join(head.split())).strip()
            if not name:
                continue
            items.append({
                "name": name,
                "quantity": qty,
                "unit": unit,
                "price_unit": _num(im.group(1)),
                "amount": _num(im.group(2)),
            })
        total = _num(m.group(5))
        items_total = round(sum(i["amount"] or 0 for i in items), 2)
        bills.append({
            "date": m.group(1),
            "txn_type": m.group(2),
            "ref_no": m.group(3),
            "status": m.group(4),
            "total": total,
            "items": items,
            "items_total": items_total,
            # Self-check: a bill whose lines do not add up to its stated total
            # is either a parse failure or a genuinely malformed bill.
            "items_match_total": total is not None and abs(items_total - total) < 0.01,
        })
    return bills


def _tokens(s: str) -> set[str]:
    """Alphanumeric tokens of length>=3, upper-cased, for loose name matching."""
    return {t for t in re.split(r"[^A-Za-z0-9]+", (s or "").upper()) if len(t) >= 3}


def build_report(orders: list[dict], bills: list[dict], known_skus: list[str]) -> dict:
    """
    Facts + unmatched flags. Suggested SKU links are heuristic token overlap and
    are labelled as suggestions — never used to compute money.
    """
    sku_tokens = {s: _tokens(s) for s in known_skus}

    for o in orders:
        o["sku_known"] = o["sku"] in sku_tokens

    for b in bills:
        for it in b["items"]:
            it_tokens = _tokens(it["name"])
            best, best_hits = None, 0
            for sku, toks in sku_tokens.items():
                hits = len(it_tokens & toks)
                if hits > best_hits:
                    best, best_hits = sku, hits
            # One shared token is noise; require at least two.
            it["suggested_sku"] = best if best_hits >= 2 else None
            it["match_tokens"] = best_hits if best_hits >= 2 else 0

    sold = round(sum(o["invoice_amount"] or 0 for o in orders), 2)
    bought = round(sum(b["total"] or 0 for b in bills if b["txn_type"] == "Sale"), 2)
    line_items = [it for b in bills for it in b["items"]]

    return {
        "orders": orders,
        "bills": bills,
        "summary": {
            "order_count": len(orders),
            "orders_total": sold,
            "orders_unknown_sku": sum(1 for o in orders if not o["sku_known"]),
            "orders_returned": sum(1 for o in orders if "return" in (o["state"] or "").lower()),
            "bill_count": len(bills),
            "bills_total": bought,
            "bill_line_items": len(line_items),
            "bills_not_adding_up": sum(1 for b in bills if not b["items_match_total"]),
            "bill_items_unmatched": sum(1 for it in line_items if not it["suggested_sku"]),
            "bills_unpaid": sum(1 for b in bills if (b["status"] or "").lower() == "unpaid"),
        },
    }
