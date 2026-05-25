from pydantic import BaseModel
from datetime import datetime, date
from typing import Optional


# ── SKU Row ──────────────────────────────────────────────────────────────────

class PnlSkuRowResponse(BaseModel):
    id: int
    platform_sku_name: str
    sku_pricing_id: Optional[int]

    # Units
    gross_units: Optional[int]
    rto_units: Optional[int]
    rvp_units: Optional[int]
    cancelled_units: Optional[int]
    net_units: Optional[int]

    # Return rate (computed field — derived from gross/net units)
    return_rate_pct: Optional[float] = None

    # Flipkart actuals
    accounted_net_sales: Optional[float]
    commission_fee: Optional[float]
    collection_fee: Optional[float]
    fixed_fee: Optional[float] = None
    reverse_shipping_fee: Optional[float]
    taxes_gst: Optional[float]
    taxes_tcs: Optional[float]
    taxes_tds: Optional[float]
    rewards_benefits: Optional[float]
    bank_settlement_projected: Optional[float]
    input_tax_credits: Optional[float]
    net_earnings: Optional[float]
    earnings_per_unit: Optional[float]
    net_margin_pct: Optional[float]
    amount_settled: Optional[float]
    amount_pending: Optional[float]

    # Casper snapshot
    casper_expected_bs: Optional[float]
    casper_expected_profit_pct: Optional[float]
    variance_bs: Optional[float]
    variance_margin_pct: Optional[float]

    # Casper pricing ladder (live from sku_pricing) — full breakdown for P&L view
    # ── Unit Economics group (cost components) ─────────────────────────
    casper_price: Optional[float] = None
    casper_package: Optional[float] = None
    casper_logistics: Optional[float] = None         # inbound logistics
    casper_addons: Optional[float] = None
    casper_misc_total: Optional[float] = None
    casper_cr_pct: Optional[float] = None
    casper_cr_amt: Optional[float] = None
    casper_dmg_pct: Optional[float] = None
    casper_dmg_amt: Optional[float] = None
    # ── Profitability group ────────────────────────────────────────────
    casper_breakeven: Optional[float] = None         # pure cost basis (no profit, no GST)
    casper_breakeven_gst: Optional[float] = None     # breakeven × (1 + GST%)
    casper_profit_pct: Optional[float] = None
    casper_profit_amt: Optional[float] = None        # profit % × breakeven
    casper_gst_pct: Optional[float] = None
    # ── Bank Settlement group ──────────────────────────────────────────
    casper_target_pre_gst: Optional[float] = None    # breakeven + profit (rounded)
    casper_target_post_gst: Optional[float] = None   # target_pre_gst × (1 + GST%)

    # Derived: is this SKU matched to Casper?
    is_matched: bool = False

    model_config = {"from_attributes": True}


# ── Report ───────────────────────────────────────────────────────────────────

class PnlReportSummary(BaseModel):
    """Lightweight — used in report list view"""
    id: int
    platform_id: int
    platform_name: Optional[str] = None
    period_start: date
    period_end: date
    filename: str
    uploaded_at: datetime
    status: str

    # Key metrics for list card
    gross_sales: Optional[float]
    net_sales: Optional[float]
    bank_settlement: Optional[float]
    gross_units: Optional[int]
    net_units: Optional[int]
    net_margin_pct: Optional[float]

    # Counts
    total_skus: Optional[int] = None
    matched_skus: Optional[int] = None
    unmatched_skus: Optional[int] = None

    # Platform config (for True P&L absorption math)
    target_monthly_units: Optional[int] = None

    model_config = {"from_attributes": True}


class PnlReportDetail(PnlReportSummary):
    """Full report — includes all SKU rows"""
    returns_amount: Optional[float]
    returned_units: Optional[int]
    total_expenses: Optional[float]
    input_tax_credits: Optional[float]
    net_earnings: Optional[float]
    amount_settled: Optional[float]
    amount_pending: Optional[float]

    # Platform-specific summary fields (Meesho / Snapdeal)
    gross_orders: Optional[int] = None
    return_orders: Optional[int] = None
    net_orders: Optional[int] = None
    tcs_amount: Optional[float] = None
    tds_amount: Optional[float] = None
    marketing_fee: Optional[float] = None

    sku_rows: list[PnlSkuRowResponse] = []

    model_config = {"from_attributes": True}


# ── Upload response ───────────────────────────────────────────────────────────

class PnlUploadResult(BaseModel):
    """Returned immediately after upload"""
    report_id: int
    platform_name: str
    period_start: date
    period_end: date
    total_skus: int
    matched_skus: int
    unmatched_skus: int
    duplicate: bool = False               # True if a report for this period already existed
    duplicate_report_id: Optional[int] = None
    parse_warnings: list[str] = []        # Critical fields with >30% null values


# ── Duplicate check ───────────────────────────────────────────────────────────

class PnlDuplicateInfo(BaseModel):
    """Sent to frontend when a duplicate period is detected before confirming overwrite"""
    existing_report_id: int
    platform_name: str
    period_start: date
    period_end: date
    uploaded_at: datetime
    filename: str
