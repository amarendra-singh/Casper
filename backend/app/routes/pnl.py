"""
P&L Routes

POST /pnl/upload                  → upload xlsx, parse, store (with duplicate detection)
GET  /pnl/reports                 → list all reports (optionally filter by platform_id)
GET  /pnl/reports/{report_id}     → full report detail with SKU rows
DELETE /pnl/reports/{report_id}   → delete report + all rows
GET  /pnl/platforms               → platforms that have at least one report (for dynamic sidebar)
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_any, require_admin_or_above
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
    get_all_reports,
    get_report_detail,
    delete_report,
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

    pnl_logger.info(f"File read — size={len(file_bytes)} bytes")

    # Auto-extract period from file
    try:
        period_start, period_end = extract_period_from_bytes(file_bytes)
        pnl_logger.info(f"Period extracted — {period_start} to {period_end}")
    except ValueError as e:
        pnl_logger.error(f"Period extraction failed — {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # Duplicate check using extracted period
    existing = await check_duplicate(db, platform_id, period_start, period_end)
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
        await delete_report(db, existing.id)

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
        )
        pnl_logger.info(
            f"Upload complete — report_id={result.report_id} "
            f"matched={result.matched_skus} unmatched={result.unmatched_skus} "
            f"total={result.total_skus} period={period_start}→{period_end}"
        )
    except Exception as e:
        pnl_logger.error(f"Parse failed — {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Failed to parse report: {str(e)}",
        )

    return result


# ── List reports ──────────────────────────────────────────────────────────────

@router.get("/reports", response_model=list[PnlReportSummary])
async def list_reports(
    platform_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_any),
):
    """List all P&L reports, optionally filtered by platform."""
    reports = await get_all_reports(db, platform_id=platform_id)

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

@router.get("/reports/{report_id}", response_model=PnlReportDetail)
async def get_report(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_any),
):
    """Full report with all SKU rows."""
    report = await get_report_detail(db, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found.")

    plat = await db.get(Platform, report.platform_id)

    # Build SKU row responses with computed fields
    sku_rows = []
    for row in report.sku_rows:
        gross = row.gross_units or 0
        net = row.net_units or 0
        return_rate = round((gross - net) / gross * 100, 1) if gross > 0 else None

        sku_rows.append(PnlSkuRowResponse(
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
            casper_expected_bs=row.casper_expected_bs,
            casper_expected_profit_pct=row.casper_expected_profit_pct,
            variance_bs=row.variance_bs,
            variance_margin_pct=row.variance_margin_pct,
            is_matched=row.sku_pricing_id is not None,
        ))

    total = len(sku_rows)
    matched = sum(1 for r in sku_rows if r.is_matched)

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
        returns_amount=report.returns_amount,
        returned_units=report.returned_units,
        total_expenses=report.total_expenses,
        input_tax_credits=report.input_tax_credits,
        net_earnings=report.net_earnings,
        amount_settled=report.amount_settled,
        amount_pending=report.amount_pending,
        sku_rows=sku_rows,
    )


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/reports/{report_id}", status_code=204)
async def remove_report(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin_or_above),
):
    """Delete a P&L report and all its SKU rows. Admin+ only."""
    deleted = await delete_report(db, report_id)
    if not deleted:
        pnl_logger.warning(f"Delete failed — report_id={report_id} not found")
        raise HTTPException(status_code=404, detail="Report not found.")
    pnl_logger.info(f"Report deleted — report_id={report_id}")


# ── Platforms with reports (for dynamic sidebar) ──────────────────────────────

@router.get("/platforms-with-reports")
async def platforms_with_reports(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_any),
):
    """
    Returns platforms that have at least one P&L report.
    Frontend uses this to build the dynamic P&L sub-menu.
    """
    result = await db.execute(
        select(Platform.id, Platform.name)
        .join(PnlReport, PnlReport.platform_id == Platform.id)
        .distinct()
        .order_by(Platform.name)
    )
    rows = result.all()
    return [{"id": r.id, "name": r.name} for r in rows]
