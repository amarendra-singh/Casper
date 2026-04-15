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

    # COGS — purchase price per unit from sku_pricing.price (populated via @property on model)
    cogs: Optional[float] = None

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


# ── Duplicate check ───────────────────────────────────────────────────────────

class PnlDuplicateInfo(BaseModel):
    """Sent to frontend when a duplicate period is detected before confirming overwrite"""
    existing_report_id: int
    platform_name: str
    period_start: date
    period_end: date
    uploaded_at: datetime
    filename: str
