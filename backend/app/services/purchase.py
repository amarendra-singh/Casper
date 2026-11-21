"""
Persisting supplier bills and resolving their lines to SKUs.

Matching runs in two tiers, deliberately:
  1. `alias`     — a mapping a human confirmed once. Exact, trustworthy.
  2. `suggested` — name-token overlap. A hint only; never used to move money.

Anything else stays `none` and is surfaced as unmatched rather than guessed at.
"""
import re
from datetime import date, datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.purchase import PurchaseBill, PurchaseBillLine, VendorItemAlias
from app.models.sku import Sku, SkuPricing
from app.models.ledger import LedgerEntry


def _norm(s: str) -> str:
    """Collapse to a comparable key: upper-cased, single-spaced."""
    return " ".join((s or "").upper().split())


def _tokens(s: str) -> set[str]:
    return {t for t in re.split(r"[^A-Za-z0-9]+", (s or "").upper()) if len(t) >= 3}


def suggest_sku(item_name: str, sku_tokens: dict[int, tuple[str, set[str]]]) -> tuple[Optional[int], int]:
    """Unique best token-overlap candidate; tied pack variants need human choice."""
    it = _tokens(item_name)
    best_id, best_hits = None, 0
    tied = False
    for sku_id, (_code, toks) in sku_tokens.items():
        hits = len(it & toks)
        if hits > best_hits:
            best_id, best_hits = sku_id, hits
            tied = False
        elif hits == best_hits:
            tied = True
    return (best_id, best_hits) if best_hits >= 2 and not tied else (None, 0)


_GENERIC = {'GLASS', 'WHISKY', 'WHISKEY', 'TUMBLER', 'PCS', 'PIECE', 'PIECES',
            'SET', 'BOX', 'COL', 'CTN', 'WITH', 'PACK', 'WATER', 'JUICE', 'BOTTLE'}


def sku_candidates(item_name, skus, vendor_id=None):
    """Identify product candidates, retaining all tied pack variants for review."""
    item = _norm(item_name)
    tokens = _tokens(item)
    ranked = []
    for sku in skus:
        if vendor_id is not None and sku.vendor_id != vendor_id:
            continue
        code = _norm(sku.shringar_sku)
        vendor = _norm(sku.vendor_sku)
        score = 0
        if code and re.search(r'(?<![A-Z0-9-])' + re.escape(code) + r'(?![A-Z0-9-])', item):
            score = 100
        elif vendor and re.search(r'(?<![A-Z0-9-])' + re.escape(vendor) + r'(?![A-Z0-9-])', item):
            score = 80
        else:
            # Full model codes such as ZZB-C must not collapse into ZZB and
            # thereby match ZZB-D. Descriptive names may share distinctive words.
            words = _tokens(' '.join(filter(None, (sku.vendor_sku, sku.description))))
            distinctive = {w for w in words - _GENERIC if w.isalpha() and len(w) >= 4}
            hits = len(distinctive & tokens)
            if hits:
                score = 20 + hits
        if score:
            ranked.append((score, sku))
    best = max((score for score, _ in ranked), default=0)
    return [sku for score, sku in ranked if score == best]


async def _matching_data(db, company_id):
    skus = (await db.scalars(select(Sku).where(
        Sku.company_id == company_id, Sku.is_active == True))).all()
    valid_ids = {s.id for s in skus}
    aliases = (await db.scalars(select(VendorItemAlias).where(
        VendorItemAlias.company_id == company_id))).all()
    grouped = {}
    for alias in aliases:
        if alias.sku_id in valid_ids:
            grouped.setdefault((alias.supplier_key, _norm(alias.item_name)), []).append(alias)
    # Conflicting legacy spellings cannot silently pick a winner.
    resolved = {key: rows[0] for key, rows in grouped.items()
                if len({(a.sku_id, a.pack_multiple) for a in rows}) == 1}
    return skus, resolved


async def _sync_ledger_sku(db, bill):
    if not bill.ledger_entry_id:
        return
    await db.flush()
    lines = (await db.scalars(select(PurchaseBillLine).where(PurchaseBillLine.bill_id == bill.id))).all()
    confirmed = {ln.sku_id for ln in lines if ln.sku_id and ln.match_source in ('manual', 'alias')}
    complete = bool(lines) and all(ln.sku_id and ln.match_source in ('manual', 'alias') for ln in lines)
    entry = await db.get(LedgerEntry, bill.ledger_entry_id)
    if entry is not None and entry.company_id == bill.company_id:
        entry.sku_id = next(iter(confirmed)) if complete and len(confirmed) == 1 else None


async def rematch_bills(db, company_id, supplier_key=None):
    """Apply only confirmed supplier mappings; expose other candidates on reads.

    No costs or amounts change. Caller owns the transaction.
    """
    _, aliases = await _matching_data(db, company_id)
    query = select(PurchaseBill).where(PurchaseBill.company_id == company_id)
    if supplier_key is not None:
        query = query.where(PurchaseBill.supplier_key == supplier_key)
    matched = 0
    for bill in (await db.scalars(query)).all():
        for line in bill.lines:
            if line.match_source in ('manual', 'alias') and line.sku_id:
                continue
            alias = aliases.get((bill.supplier_key, _norm(line.item_name)))
            if alias:
                line.sku_id, line.pack_multiple, line.match_source = alias.sku_id, alias.pack_multiple, 'alias'
                matched += 1
        await _sync_ledger_sku(db, bill)
    await db.flush()
    return matched


def _parse_date(s: str) -> date:
    """Vyapar prints dd/mm/yyyy."""
    return datetime.strptime(s, "%d/%m/%Y").date()


async def save_bills(
    db: AsyncSession,
    company_id: int,
    vendor_id: Optional[int],
    party_name: Optional[str],
    parsed: list[dict],
    source_file: Optional[str],
) -> dict:
    """
    Upsert parsed bills by (company, vendor, ref_no) and resolve each line.

    Statements overlap by date range, so re-uploading must not duplicate: an
    existing bill has its lines replaced wholesale, which also lets a corrected
    statement fix an earlier bad parse.
    """
    from app.services.tenant_refs import validate_references
    await validate_references(db, company_id, {'vendor_id': vendor_id})
    if vendor_id is None and not (party_name or '').strip():
        raise ValueError("Identify the supplier before saving bills")
    supplier_key = f'vendor:{vendor_id}' if vendor_id is not None else 'party:' + _norm(party_name)
    if vendor_id is not None:
        keys = (await db.scalars(select(PurchaseBill.supplier_key).where(
            PurchaseBill.company_id == company_id, PurchaseBill.vendor_id == vendor_id).distinct())).all()
        if len(keys) > 1:
            from fastapi import HTTPException
            raise HTTPException(409, 'Supplier has multiple bill identities; reconcile them before importing')
        if keys:
            supplier_key = keys[0]
    # Registering an already imported named supplier must not create a second
    # identity and duplicate its bills/expenses on the next statement upload.
    party_key = 'party:' + _norm(party_name)
    if vendor_id is not None and (party_name or '').strip():
        previous = await db.scalar(select(PurchaseBill.id).where(
            PurchaseBill.company_id == company_id, PurchaseBill.supplier_key == party_key).limit(1))
        if previous is not None:
            if keys and supplier_key != party_key:
                from fastapi import HTTPException
                raise HTTPException(409, 'Supplier has an unlinked bill identity; reconcile it before importing')
            supplier_key = party_key
    skus, aliases = await _matching_data(db, company_id)

    # Replacing edited lines loses the user's corrections. Approved costs also
    # cite line IDs, so replacement would orphan their financial source. Reject
    # the entire upload before mutating any bill in the file.
    from app.models.catalogue import StockCost
    from fastapi import HTTPException
    for incoming in parsed:
        if incoming.get("txn_type", "Sale") != "Sale":
            continue
        existing = await db.scalar(select(PurchaseBill).where(
            PurchaseBill.company_id == company_id,
            PurchaseBill.supplier_key == supplier_key,
            PurchaseBill.ref_no == str(incoming["ref_no"])))
        if existing and existing.lines:
            if any(line.edited_at is not None for line in existing.lines):
                raise HTTPException(409, f"Bill {existing.ref_no} has manual edits; correct it in the bill table instead of reuploading")
            ids = [line.id for line in existing.lines]
            approved = await db.scalar(select(StockCost.id).where(
                StockCost.company_id == company_id,
                StockCost.source_type == "bill_line",
                StockCost.source_id.in_(ids)).limit(1))
            if approved:
                raise HTTPException(409, f"Bill {existing.ref_no} has an approved cost; its lines cannot be replaced by reupload")
    created = updated = 0
    for b in parsed:
        # Payment and credit/debit rows are not purchase expenses. Do not
        # silently post their positive totals as additional inventory purchases.
        if b.get('txn_type', 'Sale') != 'Sale':
            continue
        existing = (await db.execute(
            select(PurchaseBill).where(
                PurchaseBill.company_id == company_id,
                PurchaseBill.supplier_key == supplier_key,
                PurchaseBill.ref_no == str(b["ref_no"]),
            )
        )).scalar_one_or_none()

        preserved_units = {}
        preserved = {}
        if existing is not None:
            for ln in existing.lines:
                preserved_units.setdefault(_norm(ln.item_name), set()).add((ln.unit, ln.pieces_per_unit))
                if ln.sku_id and ln.match_source in ('manual', 'alias'):
                    preserved.setdefault(_norm(ln.item_name), set()).add((ln.sku_id, ln.pack_multiple, ln.match_source))
        if existing is None:
            bill = PurchaseBill(
                company_id=company_id, vendor_id=vendor_id, party_name=party_name, supplier_key=supplier_key,
                ref_no=str(b["ref_no"]), bill_date=_parse_date(b["date"]),
                txn_type=b.get("txn_type") or "Sale",
                status=(b.get("status") or "unpaid").lower(),
                source="vyapar_pdf", source_file=source_file, lines=[],
            )
            db.add(bill)
            await db.flush()
            created += 1
        else:
            bill = existing
            if vendor_id is not None:
                bill.vendor_id = vendor_id
            bill.bill_date = _parse_date(b["date"])
            bill.status = (b.get("status") or "unpaid").lower()
            bill.source_file = source_file or bill.source_file
            bill.lines.clear()
            await db.flush()
            updated += 1

        bill.total = b.get("total") or 0.0
        bill.lines_total = round(sum(i.get("amount") or 0 for i in b.get("items", [])), 2)

        line_skus: list[Optional[int]] = []
        for n, item in enumerate(b.get("items", []), start=1):
            name = item.get("name") or ""
            saved_units = preserved_units.get(_norm(name), set())
            unit, pieces = next(iter(saved_units)) if len(saved_units) == 1 else (item.get("unit"), None)
            previous = preserved.get(_norm(name), set())
            alias = aliases.get((supplier_key, _norm(name)))
            if len(previous) == 1:
                sku_id, pack, src = next(iter(previous))
            elif alias:
                sku_id, src, pack = alias.sku_id, "alias", alias.pack_multiple or 1.0
            else:
                candidates = sku_candidates(name, skus, vendor_id)
                guess = candidates[0].id if len(candidates) == 1 else None
                sku_id, src, pack = guess, ("suggested" if guess else "none"), 1.0
            line_skus.append(sku_id if src in ('alias', 'manual') else None)
            bill.lines.append(PurchaseBillLine(
                bill_id=bill.id, line_no=n, item_name=name,
                quantity=item.get("quantity"), unit=unit, pieces_per_unit=pieces,
                price_unit=item.get("price_unit"), amount=item.get("amount"),
                sku_id=sku_id, match_source=src, pack_multiple=pack,
            ))

        await _post_to_ledger(db, bill, b.get("items", []), line_skus)

    await db.commit()
    return {"bills_created": created, "bills_updated": updated,
            "skipped_transactions": sum(b.get('txn_type', 'Sale') != 'Sale' for b in parsed)}


def _describe(items: list[dict]) -> Optional[str]:
    """
    What this bill was for, in one line.

    The ledger already shows the ref in its own column, so repeating it here
    would waste the widest column on the table. Name the goods instead.
    """
    names = [(" ".join((i.get("name") or "").split()))[:48] for i in items if i.get("name")]
    if not names:
        return None
    if len(names) == 1:
        return names[0]
    return f"{names[0]} +{len(names) - 1} more"


async def _post_to_ledger(
    db: AsyncSession, bill: PurchaseBill, items: list[dict], line_skus: list[Optional[int]],
) -> None:
    """
    Mirror a bill into the general ledger as one expense line.

    Without this a bill is invisible to Expense Ledger totals — the reason the
    page could show ₹0 out while thousands of rupees of bills were on file.
    Updating in place (rather than inserting) keeps re-uploads idempotent.
    """
    entry = None
    if bill.ledger_entry_id:
        entry = (await db.execute(
            select(LedgerEntry).where(LedgerEntry.id == bill.ledger_entry_id)
        )).scalar_one_or_none()

    if entry is None:
        entry = LedgerEntry(company_id=bill.company_id)
        db.add(entry)

    entry.entry_date = bill.bill_date
    entry.direction = "expense"
    entry.category = "inventory"
    entry.amount = bill.total or 0.0
    entry.vendor_id = bill.vendor_id
    entry.party_name = bill.party_name
    entry.reference_no = bill.ref_no
    entry.note = _describe(items)
    # Only when the whole bill resolves to one SKU — otherwise the column would
    # imply a single-SKU purchase that the bill does not support.
    resolved = {s for s in line_skus if s}
    entry.sku_id = next(iter(resolved)) if line_skus and all(line_skus) and len(resolved) == 1 else None
    await db.flush()
    bill.ledger_entry_id = entry.id


async def bills_view(db: AsyncSession, company_id: int, vendor_id: Optional[int]) -> list[dict]:
    """Saved bills with their lines, each line carrying the SKU's current cost.

    Bill rate and recorded cost sit side by side so a difference is visible; the
    difference itself is only computed when both numbers actually exist.
    """
    q = select(PurchaseBill).where(PurchaseBill.company_id == company_id)
    if vendor_id is not None:
        q = q.where(PurchaseBill.vendor_id == vendor_id)
    bills = (await db.execute(q.order_by(PurchaseBill.bill_date, PurchaseBill.ref_no))).scalars().all()
    matching_skus, aliases = await _matching_data(db, company_id)

    sku_rows = (await db.execute(
        select(Sku.id, Sku.shringar_sku, SkuPricing.price, SkuPricing.id, SkuPricing.platform_id)
        .join(SkuPricing, (SkuPricing.sku_id == Sku.id) & (SkuPricing.company_id == company_id), isouter=True)
        .where(Sku.company_id == company_id)
        .order_by(SkuPricing.platform_id, SkuPricing.id)
    )).all()
    pricing_options = {}
    sku_info = {}
    for sid, code, price, pricing_id, platform_id in sku_rows:
        if pricing_id is not None:
            pricing_options.setdefault(sid, []).append({"platform_id": platform_id, "price": price})
        sku_info.setdefault(sid, {"code": code, "cost": price, "pricing_id": pricing_id, "platform_id": platform_id})

    sku_models = {s.id: s for s in matching_skus}
    out = []
    for b in bills:
        lines = []
        for ln in sorted(b.lines, key=lambda x: x.line_no):
            confirmed = ln.sku_id and ln.match_source in ('manual', 'alias')
            alias = aliases.get((b.supplier_key, _norm(ln.item_name)))
            candidates = [] if confirmed else sku_candidates(ln.item_name, matching_skus, b.vendor_id)
            info = sku_info.get(ln.sku_id) if ln.sku_id else None
            model = sku_models.get(ln.sku_id)
            units = model.base_units_per_sku if model else None
            unit_cost = (round(ln.price_unit / ln.pieces_per_unit, 2)
                         if ln.price_unit is not None and ln.pieces_per_unit else ln.unit_cost)
            recorded = info["cost"] if info else None
            diff = (round(unit_cost - recorded / units, 2)
                    if confirmed and unit_cost is not None and recorded is not None and units else None)
            lines.append({
                "id": ln.id, "line_no": ln.line_no, "item_name": ln.item_name,
                "quantity": ln.quantity, "unit": ln.unit, "pieces_per_unit": ln.pieces_per_unit,
                "price_unit": ln.price_unit, "amount": ln.amount,
                "pack_multiple": ln.pack_multiple, "unit_cost": unit_cost,
                "sku_id": ln.sku_id,
                "base_units_per_sku": units,
                "stock_item_id": model.stock_item_id if model else None,
                "sku_code": info["code"] if info else None,
                "recorded_cost": recorded,
                "platform_costs": pricing_options.get(ln.sku_id, []),
                "pricing_id": info["pricing_id"] if info else None,
                "pricing_platform_id": info["platform_id"] if info else None,
                "cost_diff": diff,
                "match_source": ln.match_source,
                "candidates": [{"id": s.id, "code": s.shringar_sku, "vendor_sku": s.vendor_sku} for s in candidates],
                "match_reason": ('Confirmed supplier mapping available' if not confirmed and alias else
                    'Choose the SKU variant and confirm the billed-unit conversion' if len(candidates) > 1 else
                    'Confirm this product and the billed-unit conversion' if candidates else
                    'No reliable catalogue candidate' if not confirmed else None),
            })
        out.append({
            "id": b.id, "ref_no": b.ref_no, "bill_date": b.bill_date.isoformat(),
            "txn_type": b.txn_type, "status": b.status,
            "total": b.total, "lines_total": b.lines_total, "reconciles": b.reconciles,
              "party_name": b.party_name, "vendor_id": b.vendor_id, "lines": lines,
        })
    return out


async def link_line(
    db: AsyncSession, company_id: int, line_id: int,
    sku_id: Optional[int], pack_multiple: float, remember: bool,
) -> dict:
    """Confirm (or clear) the SKU behind a bill line, optionally remembering it."""
    line = (await db.execute(
        select(PurchaseBillLine).join(PurchaseBill)
        .where(PurchaseBillLine.id == line_id, PurchaseBill.company_id == company_id)
    )).scalar_one_or_none()
    if line is None:
        return {"ok": False, "error": "Line not found"}

    import math
    if not math.isfinite(pack_multiple) or pack_multiple <= 0:
        return {"ok": False, "error": "Pack multiple must be positive and finite"}
    from app.services.tenant_refs import validate_references
    try:
        await validate_references(db, company_id, {'sku_id': sku_id})
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}
    line.sku_id = sku_id
    line.pack_multiple = pack_multiple or 1.0
    line.match_source = "manual" if sku_id else "none"
    await db.flush()
    bill = await db.get(PurchaseBill, line.bill_id)
    await _sync_ledger_sku(db, bill)

    if remember and sku_id:
        bill = (await db.execute(
            select(PurchaseBill).where(PurchaseBill.id == line.bill_id)
        )).scalar_one()
        existing = (await db.execute(
            select(VendorItemAlias).where(
                VendorItemAlias.company_id == company_id,
                VendorItemAlias.supplier_key == bill.supplier_key,
            )
        )).scalars().all()
        existing = [a for a in existing if _norm(a.item_name) == _norm(line.item_name)]
        if existing:
            for alias in existing:
                alias.sku_id = sku_id
                alias.pack_multiple = line.pack_multiple
        else:
            db.add(VendorItemAlias(
                company_id=company_id, vendor_id=bill.vendor_id,
                supplier_key=bill.supplier_key, item_name=_norm(line.item_name), sku_id=sku_id,
                pack_multiple=line.pack_multiple,
            ))
        await db.flush()
        await rematch_bills(db, company_id, bill.supplier_key)
    elif remember and sku_id is None:
        aliases = (await db.scalars(select(VendorItemAlias).where(
            VendorItemAlias.company_id == company_id,
            VendorItemAlias.supplier_key == bill.supplier_key))).all()
        for alias in aliases:
            if _norm(alias.item_name) == _norm(line.item_name):
                await db.delete(alias)
    await db.commit()
    return {"ok": True, "line_id": line_id, "sku_id": sku_id, "pack_multiple": line.pack_multiple}


async def apply_cost(db: AsyncSession, company_id: int, line_id: int, pricing_id: int | None = None) -> dict:
    """
    Write a bill line's unit cost onto its SKU's pricing as the new Product Cost.

    Only ever applies an explicit, already-linked line, and never invents a
    pricing row where none exists — a missing row means the SKU was never
    costed, which is a data problem to surface, not to paper over.
    """
    line = (await db.execute(
        select(PurchaseBillLine).join(PurchaseBill)
        .where(PurchaseBillLine.id == line_id, PurchaseBill.company_id == company_id)
    )).scalar_one_or_none()
    if line is None:
        return {"ok": False, "error": "Line not found"}
    if line.pieces_per_unit:
        return {"ok": False, "error": "Use catalogue cost approval for explicit supplier units"}
    if not line.sku_id:
        return {"ok": False, "error": "Link this line to a SKU first"}
    import math
    if line.match_source not in ('manual', 'alias'):
        return {"ok": False, "error": "Confirm the suggested SKU match before applying cost"}
    if not math.isfinite(line.pack_multiple) or line.pack_multiple <= 0:
        return {"ok": False, "error": "Pack multiple must be positive and finite"}
    cost = line.unit_cost
    if cost is None or not math.isfinite(cost) or cost <= 0:
        return {"ok": False, "error": "This line has no rate to apply"}

    pricings = (await db.execute(
        select(SkuPricing).where(
            SkuPricing.sku_id == line.sku_id, SkuPricing.company_id == company_id
        )
        .order_by(SkuPricing.platform_id, SkuPricing.id)
    )).scalars().all()
    if not pricings:
        return {"ok": False, "error": "That SKU has no pricing row yet — add it on Unit Economics first"}

    if pricing_id is not None:
        pricings = [p for p in pricings if p.id == pricing_id]
        if not pricings:
            return {"ok": False, "error": "Selected pricing does not belong to this bill SKU"}
    elif len(pricings) > 1:
        return {"ok": False, "error": "Select a pricing record; this SKU has costs on multiple platforms"}

    from app.services.pricing import recalculate_pricing
    previous = pricings[0].price
    for pricing in pricings:
        pricing.price = cost
        await recalculate_pricing(db, pricing)
    from app.services.pnl_statement import recover_unpriced_reports
    await recover_unpriced_reports(db, company_id)
    await db.commit()
    return {"ok": True, "sku_id": line.sku_id, "previous_cost": previous, "new_cost": cost}
