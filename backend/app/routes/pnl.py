"""
P&L Routes

POST /pnl/upload                  → upload xlsx, parse, store (with duplicate detection)
GET  /pnl/reports                 → list all reports (optionally filter by platform_id)
GET  /pnl/reports/{report_id}     → full report detail with SKU rows
DELETE /pnl/reports/{report_id}   → delete report + all rows
GET  /pnl/platforms               → platforms that have at least one report (for dynamic sidebar)
"""

from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

UPLOADS_DIR = Path(__file__).parent.parent.parent / "uploads" / "pnl"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# Max accepted upload size — guards against memory-exhaustion DoS via huge files.
# Real platform P&L exports are well under 25 MB.
MAX_UPLOAD_BYTES = 25 * 1024 * 1024

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_any, require_admin_or_above, get_active_company
from app.core.logging_config import pnl_logger, app_logger
from app.models.user import User
from app.models.pnl import PnlReport, PnlSkuRow
from app.models.platform import Platform
from app.schemas.pnl import (
    PnlReportSummary,
    PnlReportDetail,
    PnlSkuRowResponse,
    PnlUploadResult,
    PnlDuplicateInfo,
)
from app.services.pnl import (
    parse_and_store,
    check_duplicate,
    extract_period_from_bytes,
    extract_period_from_bytes_meesho,
    extract_period_from_bytes_snapdeal,
    extract_period_from_bytes_snapdeal_cpr,
    _is_snapdeal_cpr,
    get_all_reports,
    get_report_detail,
    delete_report,
    get_dashboard_summary,
)


router = APIRouter(prefix="/pnl", tags=["P&L"])


# ── Upload ────────────────────────────────────────────────────────────────────

@router.post("/upload", response_model=PnlUploadResult)
async def upload_pnl(
    file: UploadFile = File(...),
    platform_id: int = Form(...),
    force: bool = Form(default=False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any),
    company=Depends(get_active_company),
):
    """
    Upload a Flipkart P&L xlsx report.
    Period is auto-extracted from the file — no manual date input needed.
    Duplicate detection by platform + extracted period.
    """
    pnl_logger.info(f"Upload started — file={file.filename} platform_id={platform_id} force={force} user={current_user.id}")

    # Validate file type
    if not file.filename.endswith((".xlsx", ".xls")):
        pnl_logger.warning(f"Upload rejected — invalid file type: {file.filename}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only .xlsx or .xls files are accepted.",
        )

    # Read file bytes
    file_bytes = await file.read()
    if len(file_bytes) == 0:
        pnl_logger.warning(f"Upload rejected — empty file: {file.filename}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )

    if len(file_bytes) > MAX_UPLOAD_BYTES:
        pnl_logger.warning(f"Upload rejected — too large: {len(file_bytes)} bytes ({file.filename})")
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit.",
        )

    pnl_logger.info(f"File read — size={len(file_bytes)} bytes")

    # Resolve platform name for platform-specific parsing
    plat_obj = await db.get(Platform, platform_id)
    platform_name = plat_obj.name.lower() if plat_obj else "flipkart"

    # Auto-extract period from file (platform-specific)
    try:
        if platform_name == "meesho":
            period_start, period_end = extract_period_from_bytes_meesho(file_bytes)
        elif platform_name == "snapdeal":
            if _is_snapdeal_cpr(file_bytes):
                period_start, period_end = extract_period_from_bytes_snapdeal_cpr(file_bytes)
            else:
                period_start, period_end = extract_period_from_bytes_snapdeal(file_bytes)
        else:
            period_start, period_end = extract_period_from_bytes(file_bytes)
        pnl_logger.info(f"Period extracted — {period_start} to {period_end}")
    except ValueError as e:
        pnl_logger.error(f"Period extraction failed — {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # Duplicate check using extracted period
    existing = await check_duplicate(db, platform_id, period_start, period_end, company.id)
    if existing and not force:
        pnl_logger.warning(f"Duplicate detected — existing report_id={existing.id} period={period_start}→{period_end}")
        plat = await db.get(Platform, platform_id)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "type": "duplicate",
                "existing_report_id": existing.id,
                "platform_name": plat.name if plat else "Unknown",
                "period_start": str(existing.period_start),
                "period_end": str(existing.period_end),
                "uploaded_at": existing.uploaded_at.isoformat(),
                "filename": existing.filename,
            },
        )

    if existing and force:
        pnl_logger.info(f"Force replace — deleting existing report_id={existing.id}")
        # Delete old saved file if present
        for old_file in UPLOADS_DIR.glob(f"{existing.id}.*"):
            old_file.unlink(missing_ok=True)
        await delete_report(db, existing.id, company.id)

    # Full parse + store
    try:
        result = await parse_and_store(
            session=db,
            file_bytes=file_bytes,
            filename=file.filename,
            platform_id=platform_id,
            uploaded_by=current_user.id,
            period_start=period_start,
            period_end=period_end,
            company_id=company.id,
            platform_name=platform_name,
        )
        # Save original file to disk for future reference / debugging
        ext = Path(file.filename).suffix or ".xlsx"
        saved_path = UPLOADS_DIR / f"{result.report_id}{ext}"
        saved_path.write_bytes(file_bytes)
        pnl_logger.info(
            f"Upload complete — report_id={result.report_id} "
            f"matched={result.matched_skus} unmatched={result.unmatched_skus} "
            f"total={result.total_skus} period={period_start}→{period_end} "
            f"file_saved={saved_path}"
        )
    except Exception as e:
        pnl_logger.error(f"Parse failed — {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Failed to parse report: {str(e)}",
        )

    # ── Parse validation warnings (critical fields with >30% nulls) ──────────
    CRITICAL_FIELDS = {
        'bank_settlement_projected': 'Bank Settlement',
        'net_units':                 'Net Units',
        'commission_fee':            'Commission Fee',
    }
    parse_warnings: list[str] = []
    if result.total_skus > 0:
        for field, label in CRITICAL_FIELDS.items():
            null_count_result = await db.execute(
                select(func.count()).select_from(PnlSkuRow).where(
                    PnlSkuRow.report_id == result.report_id,
                    getattr(PnlSkuRow, field).is_(None),
                )
            )
            null_count = null_count_result.scalar() or 0
            pct = null_count / result.total_skus
            if pct > 0.30:
                parse_warnings.append(f"{label} missing for {round(pct * 100)}% of SKUs")
                pnl_logger.warning(f"Parse warning — report_id={result.report_id} {label}: {null_count}/{result.total_skus} null")

    result.parse_warnings = parse_warnings
    return result


# ── ShopDeck customer-fraud upload ──────────────────────────────────────────────

@router.post("/shopdeck-customers")
async def upload_shopdeck_customers(
    file: UploadFile = File(...),
    persist: bool = Form(default=True),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any),
    company=Depends(get_active_company),
):
    """
    Upload a ShopDeck customer export (CSV) → score customers by RTO/cancel
    behaviour. If persist=True, flagged customers are upserted into this
    company's actor_risk_profiles so they surface in the Fraud Action Pipeline.
    """
    from app.services.shopdeck_customers import (
        parse_customer_csv, build_customer_fraud, ingest_customer_fraud,
    )
    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            detail="File too large")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")

    customers = parse_customer_csv(text)
    if not customers:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="No customer rows found in CSV")

    result = build_customer_fraud(customers)
    ingested = 0
    if persist:
        ingested = await ingest_customer_fraud(db, customers, company.id)
    pnl_logger.info(
        f"ShopDeck customers — parsed={len(customers)} ingested={ingested} "
        f"company={company.id} user={current_user.id}"
    )
    return {"parsed": len(customers), "ingested": ingested, **result}


# ── P&L statement / analytics (industry-standard income statement) ──────────────

@router.get("/statement/{report_id}")
async def pnl_statement(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any),
    company=Depends(get_active_company),
):
    """Full contribution-margin income statement for one report."""
    from app.services.pnl_statement import compute_pnl_statement
    stmt = await compute_pnl_statement(db, report_id, company.id)
    if stmt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")
    return stmt


@router.get("/rows/{report_id}")
async def pnl_rows(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any),
    company=Depends(get_active_company),
):
    """Per-SKU P&L rows with per-number calc breakdowns (backend single source of truth)."""
    from app.services.pnl_statement import compute_pnl_rows
    result = await compute_pnl_rows(db, report_id, company.id)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")
    return result


@router.get("/trend")
async def pnl_trend(
    platform_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any),
    company=Depends(get_active_company),
):
    """Period-over-period P&L trend across the company's reports."""
    from app.services.pnl_statement import compute_pnl_trend
    return await compute_pnl_trend(db, company.id, platform_id)


@router.get("/consolidated")
async def pnl_consolidated(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any),
    company=Depends(get_active_company),
):
    """Blended business-wide P&L — the latest report of each platform."""
    from app.services.pnl_statement import compute_pnl_consolidated
    return await compute_pnl_consolidated(db, company.id)


@router.get("/unmatched-skus")
async def pnl_unmatched_skus(
    report_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any),
    company=Depends(get_active_company),
):
    """SKUs seen in uploads with no cost match — the 'hidden' SKUs to add to the master."""
    from app.services.pnl_statement import compute_unmatched_skus
    return await compute_unmatched_skus(db, company.id, report_id)


@router.post("/hidden-skus/add")
async def pnl_add_hidden_sku(
    payload: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin_or_above),
    company=Depends(get_active_company),
):
    """
    Add pricing for one hidden SKU and re-match the report in the same call, so the
    P&L updates immediately instead of needing a re-upload.
    """
    from app.services.pnl_statement import quick_add_hidden_sku

    name = (payload.get("platform_sku_name") or "").strip()
    report_id = payload.get("report_id")
    price = payload.get("price")
    if not name or report_id is None or price in (None, ""):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="platform_sku_name, report_id and price are required")
    try:
        price = float(price)
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="price must be a number")
    if price <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="price must be greater than 0")

    costs = {k: float(payload[k]) for k in ("package", "logistics", "addons")
             if payload.get(k) not in (None, "")}
    result = await quick_add_hidden_sku(db, company.id, int(report_id), name, price, costs)
    if not result.get("created"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=result.get("error") or "Could not add SKU")
    pnl_logger.info(f"Hidden SKU added — {name} report={report_id} company={company.id} "
                    f"rows_matched={result['rows_matched']} user={current_user.id}")
    return result


@router.post("/rematch/{report_id}")
async def pnl_rematch(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin_or_above),
    company=Depends(get_active_company),
):
    """Re-link a report's unmatched rows against pricing that exists now."""
    from app.services.pnl_statement import rematch_report, compute_unmatched_skus
    matched = await rematch_report(db, report_id, company.id)
    remaining = await compute_unmatched_skus(db, company.id, report_id)
    return {"rows_matched": matched, "remaining_hidden": len(remaining)}


# ── List reports ──────────────────────────────────────────────────────────────

@router.get("/reports", response_model=list[PnlReportSummary])
async def list_reports(
    platform_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    company=Depends(get_active_company),
    _=Depends(require_any),
):
    """List all P&L reports, optionally filtered by platform."""
    reports = await get_all_reports(db, company.id, platform_id=platform_id)

    result = []
    for r in reports:
        # Count matched vs unmatched SKU rows
        total = await db.scalar(
            select(func.count()).where(PnlSkuRow.report_id == r.id)
        )
        matched = await db.scalar(
            select(func.count()).where(
                PnlSkuRow.report_id == r.id,
                PnlSkuRow.sku_pricing_id.isnot(None),
            )
        )
        plat = await db.get(Platform, r.platform_id)

        summary = PnlReportSummary(
            id=r.id,
            platform_id=r.platform_id,
            platform_name=plat.name if plat else None,
            period_start=r.period_start,
            period_end=r.period_end,
            filename=r.filename,
            uploaded_at=r.uploaded_at,
            status=r.status,
            gross_sales=r.gross_sales,
            net_sales=r.net_sales,
            bank_settlement=r.bank_settlement,
            gross_units=r.gross_units,
            net_units=r.net_units,
            net_margin_pct=r.net_margin_pct,
            total_skus=total,
            matched_skus=matched,
            unmatched_skus=(total - matched) if total else 0,
        )
        result.append(summary)

    return result


# ── Report detail ─────────────────────────────────────────────────────────────

def _build_sku_row_response(row) -> PnlSkuRowResponse:
    """
    Converts a PnlSkuRow ORM object to PnlSkuRowResponse.
    Casper fields (breakeven, expected BS, etc.) are read LIVE from sku_pricing
    so pricing edits in SKUs page reflect immediately in P&L views.
    """
    gross = row.gross_units or 0
    net   = row.net_units or 0
    return_rate = round((gross - net) / gross * 100, 1) if gross > 0 else None

    sp = row.sku_pricing  # may be None if unmatched
    casper_expected_bs   = sp.bank_settlement if sp else row.casper_expected_bs
    casper_breakeven     = sp.breakeven if sp else None
    gst_pct              = sp.gst if sp else None
    casper_breakeven_gst = round(sp.breakeven * (1 + (gst_pct or 0) / 100), 2) if sp else None
    # Target Pre-GST = breakeven + profit_amt (matches SKU page math)
    target_pre_gst       = round(sp.breakeven + (sp.net_profit_amt or 0), 0) if sp else None
    # Target Post-GST = bank_settlement on sku_pricing (already includes GST)
    target_post_gst      = round(sp.bank_settlement, 0) if sp else None

    return PnlSkuRowResponse(
        id=row.id,
        platform_sku_name=row.platform_sku_name,
        sku_pricing_id=row.sku_pricing_id,
        gross_units=row.gross_units,
        rto_units=row.rto_units,
        rvp_units=row.rvp_units,
        cancelled_units=row.cancelled_units,
        net_units=row.net_units,
        return_rate_pct=return_rate,
        accounted_net_sales=row.accounted_net_sales,
        commission_fee=row.commission_fee,
        collection_fee=row.collection_fee,
        fixed_fee=row.fixed_fee,
        reverse_shipping_fee=row.reverse_shipping_fee,
        taxes_gst=row.taxes_gst,
        taxes_tcs=row.taxes_tcs,
        taxes_tds=row.taxes_tds,
        rewards_benefits=row.rewards_benefits,
        bank_settlement_projected=row.bank_settlement_projected,
        input_tax_credits=row.input_tax_credits,
        net_earnings=row.net_earnings,
        earnings_per_unit=row.earnings_per_unit,
        net_margin_pct=row.net_margin_pct,
        amount_settled=row.amount_settled,
        amount_pending=row.amount_pending,
        casper_expected_bs=casper_expected_bs,
        casper_expected_profit_pct=row.casper_expected_profit_pct,
        variance_bs=row.variance_bs,
        variance_margin_pct=row.variance_margin_pct,
        is_matched=row.sku_pricing_id is not None,
        # Unit Economics breakdown
        casper_price=sp.price if sp else None,
        casper_package=sp.package if sp else None,
        casper_logistics=sp.logistics if sp else None,
        casper_addons=sp.addons if sp else None,
        casper_misc_total=sp.misc_total if sp else None,
        casper_cr_pct=sp.cr_percentage if sp else None,
        casper_cr_amt=sp.cr_cost if sp else None,
        casper_dmg_pct=sp.damage_percentage if sp else None,
        casper_dmg_amt=sp.damage_cost if sp else None,
        # Profitability
        casper_breakeven=casper_breakeven,
        casper_breakeven_gst=casper_breakeven_gst,
        casper_profit_pct=sp.profit_percentage if sp else None,
        casper_profit_amt=sp.net_profit_amt if sp else None,
        casper_gst_pct=gst_pct,
        # Bank Settlement (target)
        casper_target_pre_gst=target_pre_gst,
        casper_target_post_gst=target_post_gst,
    )


@router.get("/reports/{report_id}", response_model=PnlReportDetail)
async def get_report(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    company=Depends(get_active_company),
    _=Depends(require_any),
):
    """Full report with all SKU rows. Casper-derived fields are LIVE from sku_pricing."""
    report = await get_report_detail(db, report_id, company.id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found.")

    plat = await db.get(Platform, report.platform_id)

    sku_rows = [_build_sku_row_response(row) for row in report.sku_rows]
    total    = len(sku_rows)
    matched  = sum(1 for r in sku_rows if r.is_matched)

    return PnlReportDetail(
        id=report.id,
        platform_id=report.platform_id,
        platform_name=plat.name if plat else None,
        period_start=report.period_start,
        period_end=report.period_end,
        filename=report.filename,
        uploaded_at=report.uploaded_at,
        status=report.status,
        gross_sales=report.gross_sales,
        net_sales=report.net_sales,
        bank_settlement=report.bank_settlement,
        gross_units=report.gross_units,
        net_units=report.net_units,
        net_margin_pct=report.net_margin_pct,
        total_skus=total,
        matched_skus=matched,
        unmatched_skus=total - matched,
        target_monthly_units=plat.target_monthly_units if plat else None,
        returns_amount=report.returns_amount,
        returned_units=report.returned_units,
        total_expenses=report.total_expenses,
        input_tax_credits=report.input_tax_credits,
        net_earnings=report.net_earnings,
        amount_settled=report.amount_settled,
        amount_pending=report.amount_pending,
        # Platform-specific
        gross_orders=report.gross_orders,
        return_orders=report.return_orders,
        net_orders=report.net_orders,
        tcs_amount=report.tcs_amount,
        tds_amount=report.tds_amount,
        marketing_fee=report.marketing_fee,
        sku_rows=sku_rows,
    )


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/reports/{report_id}", status_code=204)
async def remove_report(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    company=Depends(get_active_company),
    _=Depends(require_admin_or_above),
):
    """Delete a P&L report and all its SKU rows. Admin+ only."""
    deleted = await delete_report(db, report_id, company.id)
    if not deleted:
        pnl_logger.warning(f"Delete failed — report_id={report_id} not found")
        raise HTTPException(status_code=404, detail="Report not found.")
    # Remove saved file
    for f in UPLOADS_DIR.glob(f"{report_id}.*"):
        f.unlink(missing_ok=True)
    pnl_logger.info(f"Report deleted — report_id={report_id}")


# ── Download original file ───────────────────────────────────────────────────

@router.get("/reports/{report_id}/file")
async def download_report_file(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    company=Depends(get_active_company),
    _=Depends(require_any),
):
    """Download the original uploaded Excel file for a report."""
    matches = list(UPLOADS_DIR.glob(f"{report_id}.*"))
    if not matches:
        raise HTTPException(status_code=404, detail="Original file not available.")
    file_path = matches[0]
    return FileResponse(
        path=str(file_path),
        filename=file_path.name,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


# ── Platforms with reports (for dynamic sidebar) ──────────────────────────────

@router.get("/dashboard")
async def dashboard_summary(
    db: AsyncSession = Depends(get_db),
    company=Depends(get_active_company),
    _=Depends(require_any),
):
    """Aggregated P&L stats across all platforms and periods for the dashboard."""
    return await get_dashboard_summary(db, company.id)


@router.get("/platforms-with-reports")
async def platforms_with_reports(
    db: AsyncSession = Depends(get_db),
    company=Depends(get_active_company),
    _=Depends(require_any),
):
    """
    Returns platforms that have at least one P&L report.
    Frontend uses this to build the dynamic P&L sub-menu.
    """
    result = await db.execute(
        select(Platform.id, Platform.name)
        .join(PnlReport, PnlReport.platform_id == Platform.id)
        .where(PnlReport.company_id == company.id)
        .distinct()
        .order_by(Platform.name)
    )
    rows = result.all()
    return [{"id": r.id, "name": r.name} for r in rows]


# ── FK Orders upload (actor fraud intelligence) ───────────────────────────────

@router.post("/upload/fk-orders")
async def upload_fk_orders(
    file: UploadFile = File(...),
    _current_user: User = Depends(get_current_user),
    company=Depends(get_active_company),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload Flipkart Orders file (flipkarrttt.xlsx) to extract actor fraud signals.
    This is separate from the FK P&L file. Contains: return reasons, delivery dates,
    return approval dates. Populates actor risk intelligence.
    """
    from app.services.fraud import (
        extract_order_events_fk_orders,
        store_order_events,
        compute_return_reason_clusters,
        compute_state_risk_profiles,
        compute_actor_risk_profiles,
    )

    file_bytes = await file.read()

    # Find Flipkart platform
    fk_result = await db.execute(
        select(Platform).where(Platform.name.ilike("%flipkart%"))
    )
    fk = fk_result.scalars().first()
    if not fk:
        raise HTTPException(status_code=404, detail="Flipkart platform not found in database")

    events = extract_order_events_fk_orders(file_bytes)
    if not events:
        raise HTTPException(
            status_code=422,
            detail="No order events found in file. Check that file has an 'Orders' sheet.",
        )

    await store_order_events(db, report_id=None, platform_id=fk.id, events=events, company_id=company.id)
    await compute_return_reason_clusters(db, company_id=company.id)
    await compute_state_risk_profiles(db, company_id=company.id)
    await compute_actor_risk_profiles(db, company_id=company.id)

    fraud_signals = sum(1 for e in events if e.get("fraud_signal_type") == "FRAUD_SIGNAL")
    returned      = sum(1 for e in events if e.get("order_status") == "RETURNED")

    return {
        "status":          "ok",
        "events_stored":   len(events),
        "returned_orders": returned,
        "fraud_signals":   fraud_signals,
        "platform":        fk.name,
    }
