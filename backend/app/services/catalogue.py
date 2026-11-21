"""Company-scoped product projections; amounts carry their source and unit."""
from collections import defaultdict
from datetime import date
from math import floor

from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

from app.models.catalogue import SkuImage, StockCost, StockItem, StockMovement
from app.models.category import Category
from app.models.marketplace_alias import MarketplaceSkuAlias
from app.models.platform import Platform
from app.models.pnl import PnlReport, PnlSkuRow
from app.models.purchase import PurchaseBill, PurchaseBillLine
from app.models.sku import Sku, SkuPlatformConfig, SkuPricing, SkuReverseShipping
from app.models.vendor import Vendor
from app.services.marketplace_identity import identity_candidates, normalize_name
from app.services.pnl_statement import _cost_basis


async def stock_balance(db, company_id, item_id):
    count, amount = (await db.execute(select(func.count(StockMovement.id),
        func.sum(StockMovement.base_units_delta)).where(
        StockMovement.company_id == company_id, StockMovement.stock_item_id == item_id))).one()
    return None if not count else int(amount or 0)


async def catalogue_page(db, company_ids, *, sku_id=None, q=None, platform_id=None,
                         vendor_id=None, category_id=None, active=None, page=1, page_size=40):
    conditions = [Sku.company_id.in_(company_ids)]
    if sku_id is not None:
        conditions.append(Sku.id == sku_id)
    if vendor_id is not None:
        conditions.append(Sku.vendor_id == vendor_id)
    if category_id is not None:
        conditions.append(Sku.category_id == category_id)
    if active is not None:
        conditions.append(Sku.is_active.is_(active))
    if q:
        needle = f"%{q.strip()}%"
        conditions.append(or_(Sku.shringar_sku.ilike(needle), Sku.vendor_sku.ilike(needle),
            Sku.display_name.ilike(needle), Sku.description.ilike(needle),
            Sku.vendor_id.in_(select(Vendor.id).where(Vendor.company_id.in_(company_ids),
                Vendor.name.ilike(needle))),
            Sku.id.in_(select(MarketplaceSkuAlias.sku_id).where(
                MarketplaceSkuAlias.company_id.in_(company_ids), MarketplaceSkuAlias.name.ilike(needle)))))
    total = await db.scalar(select(func.count()).select_from(Sku).where(*conditions))
    skus = (await db.scalars(select(Sku).where(*conditions)
        .order_by(Sku.shringar_sku, Sku.id).offset((page - 1) * page_size).limit(page_size))).all()
    if not skus:
        return {"total": total or 0, "page": page, "page_size": page_size, "items": []}
    sku_ids = [s.id for s in skus]
    company_id_set = set(company_ids)
    vendor_ids = {s.vendor_id for s in skus if s.vendor_id}
    category_ids = {s.category_id for s in skus if s.category_id}
    item_ids = {s.stock_item_id for s in skus if s.stock_item_id}
    vendors = {v.id: v.name for v in (await db.scalars(select(Vendor).where(
        Vendor.id.in_(vendor_ids), Vendor.company_id.in_(company_ids)))).all()} if vendor_ids else {}
    categories = {c.id: c.name for c in (await db.scalars(select(Category).where(
        Category.id.in_(category_ids), Category.company_id.in_(company_ids)))).all()} if category_ids else {}
    items = {i.id: i for i in (await db.scalars(select(StockItem).where(
        StockItem.id.in_(item_ids), StockItem.company_id.in_(company_ids)))).all()} if item_ids else {}
    images = {}
    for image in (await db.scalars(select(SkuImage).where(
        SkuImage.sku_id.in_(sku_ids), SkuImage.company_id.in_(company_ids))
        .order_by(SkuImage.is_primary.desc(), SkuImage.id))).all():
        images.setdefault(image.sku_id, image)
    pricing = defaultdict(list)
    for row in (await db.scalars(select(SkuPricing).where(
        SkuPricing.sku_id.in_(sku_ids), SkuPricing.company_id.in_(company_ids)))).all():
        pricing[row.sku_id].append(row)
    costs = {}
    if item_ids:
        for cost in (await db.scalars(select(StockCost).where(
            StockCost.stock_item_id.in_(item_ids), StockCost.company_id.in_(company_ids),
            StockCost.effective_date <= date.today())
            .order_by(StockCost.effective_date.desc(), StockCost.id.desc()))).all():
            costs.setdefault(cost.stock_item_id, cost)
    balances = {}
    if item_ids:
        for item_id, count, amount in (await db.execute(select(
            StockMovement.stock_item_id, func.count(), func.sum(StockMovement.base_units_delta))
            .where(StockMovement.stock_item_id.in_(item_ids), StockMovement.company_id.in_(company_ids))
            .group_by(StockMovement.stock_item_id))).all():
            if item_id in items:
                balances[item_id] = int(amount or 0) if count else None
    company_names = {}
    if len(company_id_set) > 1:
        from app.models.company import Company
        company_names = {c.id: c.name for c in (await db.scalars(select(Company).where(
            Company.id.in_(company_ids)))).all()}

    result = []
    for sku in skus:
        variants = pricing[sku.id]
        selected = next((p for p in variants if p.platform_id == platform_id), None) if platform_id else None
        legacy_prices = {round(p.price, 2) for p in variants}
        approved = costs.get(sku.stock_item_id)
        mapped = sku.stock_item_id in items and bool(sku.base_units_per_sku and sku.base_units_per_sku > 0)
        if approved and mapped:
            unit_cost = round(approved.cost_per_base_unit * sku.base_units_per_sku, 2)
            cost_source = "approved"
        elif len(legacy_prices) == 1:
            unit_cost = next(iter(legacy_prices))
            cost_source = "legacy_pricing"
        else:
            unit_cost = None
            cost_source = "conflicting_pricing" if len(legacy_prices) > 1 else "missing"
        balance = balances.get(sku.stock_item_id) if mapped else None
        image = images.get(sku.id)
        result.append({
            "id": sku.id, "company_id": sku.company_id,
            "company_name": company_names.get(sku.company_id),
            "our_sku": sku.shringar_sku, "vendor_sku": sku.vendor_sku,
            "name": sku.display_name or sku.shringar_sku,
            "primary_image_url": sku.primary_image_url,
            "vendor_id": sku.vendor_id, "vendor_name": vendors.get(sku.vendor_id),
            "category_id": sku.category_id, "category_name": categories.get(sku.category_id),
            "is_active": sku.is_active,
            "gst_rate": sku.gst_rate if sku.gst_rate is not None else (
                sku.hsn_code.gst_rate if sku.hsn_code else None),
            "primary_image_id": image.id if image else None,
            "stock_item_id": sku.stock_item_id if mapped else None,
            "stock_item_name": items[sku.stock_item_id].name if mapped else None,
            "base_units_per_sku": sku.base_units_per_sku if mapped else None,
            "on_hand_base_units": balance,
            "on_hand_pack_equivalent": floor(balance / sku.base_units_per_sku) if balance is not None and mapped else None,
            "purchase_cost": unit_cost, "cost_source": cost_source,
            "pricing_cost_drift": bool(approved and mapped and any(
                abs(p.price - unit_cost) > 0.001 for p in variants)),
            "cost_effective_date": approved.effective_date.isoformat() if approved and mapped else None,
            "expected_customer_return_cost": selected.cr_cost if selected else None,
            "expected_return_platform_id": platform_id,
            "platform_pricing_count": len(variants),
        })
    return {"total": total or 0, "page": page, "page_size": page_size, "items": result}


async def product_profile(db, company_ids, sku_id, *, platform_id=None, start=None, end=None):
    sku = await db.scalar(select(Sku).where(Sku.id == sku_id, Sku.company_id.in_(company_ids)))
    if sku is None:
        return None
    summary = (await catalogue_page(db, [sku.company_id], sku_id=sku.id,
        platform_id=platform_id, page_size=1)).get("items", [])
    card = next((x for x in summary if x["id"] == sku_id), None)
    if card is None:
        raise RuntimeError("Product summary missing")
    from app.models.company import Company
    owner = await db.scalar(select(Company.name).where(Company.id == sku.company_id))
    card["company_name"] = owner
    from app.models.hsn_code import HsnCode
    hsn = await db.get(HsnCode, sku.hsn_code_id) if sku.hsn_code_id else None
    images = (await db.scalars(select(SkuImage).where(SkuImage.company_id == sku.company_id,
        SkuImage.sku_id == sku.id).order_by(SkuImage.is_primary.desc(), SkuImage.id))).all()
    pricing = (await db.scalars(select(SkuPricing).where(SkuPricing.company_id == sku.company_id,
        SkuPricing.sku_id == sku.id))).all()
    platform_rows = (await db.scalars(select(Platform).where(
        Platform.company_id == sku.company_id))).all()
    platforms = {p.id: p.name for p in platform_rows}
    platform_charges = {p.id: p.cr_charge for p in platform_rows}
    shipping_overrides = {record.platform_id: record.charge for record in
        (await db.scalars(select(SkuReverseShipping).where(
            SkuReverseShipping.company_id == sku.company_id,
            SkuReverseShipping.sku_id == sku.id))).all()}
    aliases = (await db.scalars(select(MarketplaceSkuAlias).where(
        MarketplaceSkuAlias.company_id == sku.company_id,
        MarketplaceSkuAlias.sku_id == sku.id).order_by(MarketplaceSkuAlias.platform_id, MarketplaceSkuAlias.name))).all()
    stock_item = await db.scalar(select(StockItem).where(StockItem.id == sku.stock_item_id,
        StockItem.company_id == sku.company_id)) if sku.stock_item_id else None
    siblings = (await db.scalars(select(Sku).where(Sku.company_id == sku.company_id,
        Sku.stock_item_id == sku.stock_item_id).order_by(Sku.shringar_sku))).all() if stock_item else []
    movements = (await db.scalars(select(StockMovement).where(
        StockMovement.company_id == sku.company_id, StockMovement.stock_item_id == sku.stock_item_id)
        .order_by(StockMovement.movement_date.desc(), StockMovement.id.desc()).limit(30))).all() if stock_item else []
    costs = (await db.scalars(select(StockCost).where(StockCost.company_id == sku.company_id,
        StockCost.stock_item_id == sku.stock_item_id)
        .order_by(StockCost.effective_date.desc(), StockCost.id.desc()).limit(20))).all() if stock_item else []
    bills = (await db.execute(select(PurchaseBillLine, PurchaseBill).join(PurchaseBill,
        PurchaseBill.id == PurchaseBillLine.bill_id).where(PurchaseBill.company_id == sku.company_id,
        PurchaseBillLine.sku_id == sku.id,
        PurchaseBillLine.match_source.in_(["manual", "alias"]))
        .order_by(PurchaseBill.bill_date.desc(), PurchaseBillLine.id.desc()).limit(20))).all()
    performance = await product_performance(db, sku, pricing, aliases, platform_id, start, end)
    for row in performance["report_rows"]:
        row["platform_name"] = platforms.get(row["platform_id"])
    return {**card, "description": sku.description, "series": sku.series,
        "hsn_code": hsn.code if hsn else None,
        "images": [{"id": i.id, "is_primary": i.is_primary, "alt_text": i.alt_text} for i in images],
        "reverse_shipping": [{"platform_id": p.id, "platform_name": p.name,
            "platform_charge": p.cr_charge,
            "override": shipping_overrides.get(p.id)} for p in platform_rows],
        "pricing": [{"id": p.id, "platform_id": p.platform_id,
            "platform_name": platforms.get(p.platform_id), "price": p.price,
            "reverse_shipping_charge": shipping_overrides.get(
                p.platform_id, platform_charges.get(p.platform_id)),
            "reverse_shipping_overridden": p.platform_id in shipping_overrides,
            "package": p.package, "logistics": p.logistics, "addons": p.addons,
            "misc_total": p.misc_total, "cr_percentage": p.cr_percentage,
            "cr_cost": p.cr_cost, "damage_cost": p.damage_cost,
            "breakeven": p.breakeven, "bank_settlement": p.bank_settlement,
            "profit_percentage": p.profit_percentage} for p in pricing],
        "aliases": [{"platform_id": a.platform_id, "platform_name": platforms.get(a.platform_id),
            "name": a.name} for a in aliases],
        "stock_item": {"id": stock_item.id, "name": stock_item.name,
            "base_unit": stock_item.base_unit} if stock_item else None,
        "siblings": [{"id": s.id, "our_sku": s.shringar_sku,
            "base_units_per_sku": s.base_units_per_sku} for s in siblings],
        "movements": [{"id": m.id, "date": m.movement_date.isoformat(),
            "type": m.movement_type, "base_units_delta": m.base_units_delta,
            "sku_id": m.sku_id, "reason": m.reason, "reverses_id": m.reverses_id} for m in movements],
        "cost_history": [{"id": c.id, "cost_per_base_unit": c.cost_per_base_unit,
            "source_type": c.source_type, "source_id": c.source_id,
            "effective_date": c.effective_date.isoformat()} for c in costs],
        "supplier_bills": [{"bill_id": b.id, "ref_no": b.ref_no,
            "date": b.bill_date.isoformat(), "item_name": line.item_name,
            "bill_rate": line.price_unit, "pack_multiple": line.pack_multiple,
            "unit_cost": (round(line.price_unit / line.pieces_per_unit * sku.base_units_per_sku, 2)
                if line.pieces_per_unit and line.price_unit is not None and sku.base_units_per_sku else line.unit_cost), "line_id": line.id} for line, b in bills],
        "performance": performance,
    }


async def product_performance(db, sku, pricing, aliases, platform_id, start, end):
    names = {normalize_name(sku.shringar_sku)} | {normalize_name(a.name) for a in aliases}
    config_names = (await db.scalars(select(SkuPlatformConfig.platform_sku_name).where(
        SkuPlatformConfig.company_id == sku.company_id,
        SkuPlatformConfig.sku_pricing_id.in_([p.id for p in pricing])))).all() if pricing else []
    names.update(normalize_name(n) for n in config_names if n)
    conds = [PnlReport.company_id == sku.company_id, PnlReport.status == "done"]
    if platform_id:
        conds.append(PnlReport.platform_id == platform_id)
    if start:
        conds.append(PnlReport.period_end >= start)
    if end:
        conds.append(PnlReport.period_start <= end)
    pricing_ids = [p.id for p in pricing]
    match = []
    if pricing_ids:
        match.append(PnlSkuRow.sku_pricing_id.in_(pricing_ids))
    if names:
        match.append(func.upper(func.trim(PnlSkuRow.platform_sku_name)).in_(names))
    rows = (await db.execute(select(PnlSkuRow, PnlReport)
        .join(PnlReport, PnlReport.id == PnlSkuRow.report_id)
        .options(selectinload(PnlSkuRow.sku_pricing))
        .where(*conds, or_(*match))
        .order_by(PnlReport.period_end.desc(), PnlReport.id.desc()))).all() if match else []
    candidates_by_platform = {}
    selected = []
    for row, report in rows:
        if row.sku_pricing_id is not None and row.sku_pricing_id not in pricing_ids:
            continue
        linked = row.sku_pricing_id in pricing_ids
        if not linked:
            if report.platform_id not in candidates_by_platform:
                candidates_by_platform[report.platform_id] = await identity_candidates(
                    db, sku.company_id, report.platform_id)
            linked = candidates_by_platform[report.platform_id].get(
                normalize_name(row.platform_sku_name)) == {sku.id}
        if linked:
            selected.append((row, report))
    # A re-upload of the same platform period replaces that period's contribution
    # to this profile. Partly overlapping periods remain visible but are flagged.
    latest_period_report = {}
    for _row, report in selected:
        key = (report.platform_id, report.period_start, report.period_end)
        latest_period_report[key] = max(latest_period_report.get(key, 0), report.id)
    selected = [(row, report) for row, report in selected if report.id ==
                latest_period_report[(report.platform_id, report.period_start, report.period_end)]]
    periods = sorted(latest_period_report, key=lambda p: (p[0], p[1], p[2]))
    overlapping_periods = any(
        a[0] == b[0] and b[1] <= a[2]
        for a, b in zip(periods, periods[1:]))
    gross = net = customer_returns = rto = cancelled = costed_units = 0
    payout = total_cost = 0.0
    observed_reverse_shipping = 0.0
    fee_rows = profit_rows = estimated_rows = 0
    report_rows = []
    for row, report in selected:
        gross += row.gross_units or 0
        net += row.net_units or 0
        customer_returns += row.rvp_units or 0
        rto += row.rto_units or 0
        cancelled += row.cancelled_units or 0
        if row.reverse_shipping_fee is not None:
            observed_reverse_shipping += abs(row.reverse_shipping_fee)
            fee_rows += 1
        basis, frozen = _cost_basis(row)
        row_profit = None
        if basis["breakeven"] is not None and row.bank_settlement_projected is not None:
            units = row.net_units or 0
            row_cost = basis["breakeven"] * units
            row_profit = round(row.bank_settlement_projected - row_cost, 2)
            payout += row.bank_settlement_projected
            total_cost += row_cost
            costed_units += units
            profit_rows += 1
            if not frozen:
                estimated_rows += 1
        report_rows.append({"report_id": report.id, "platform_id": report.platform_id,
            "period_start": report.period_start.isoformat(), "period_end": report.period_end.isoformat(),
            "name": row.platform_sku_name, "gross_units": row.gross_units,
            "net_units": row.net_units, "customer_returns": row.rvp_units,
            "rto_units": row.rto_units, "payout": row.bank_settlement_projected,
            "profit": row_profit, "cost_frozen": frozen if row_profit is not None else None})
    return {"gross_units": gross, "net_units": net, "customer_returns": customer_returns,
        "rto_units": rto, "cancelled_units": cancelled,
        "costed_units": costed_units, "identity_linked_rows": len(selected),
        "profit_rows": profit_rows, "estimated_cost_rows": estimated_rows,
        "observed_reverse_shipping": round(observed_reverse_shipping, 2) if fee_rows else None,
        "reverse_shipping_rows": fee_rows,
        "profit_payout": round(payout, 2) if profit_rows else None,
        "profit_cost": round(total_cost, 2) if profit_rows else None,
        "profit": round(payout - total_cost, 2) if profit_rows else None,
        "return_on_cost_pct": round((payout - total_cost) / total_cost * 100, 1) if total_cost else None,
        "report_rows": report_rows[:50], "report_rows_total": len(report_rows),
        "period_start": start.isoformat() if start else None,
        "period_end": end.isoformat() if end else None,
        "platform_id": platform_id,
        "overlapping_periods": overlapping_periods,
        "period_filter_basis": "report_overlap"}
