"""
Fraud Detection Service — Intelligent Return & Risk Analysis

Order Event Extraction (called at upload time):
  extract_order_events_fk()        — from FK "Orders P&L" sheet
  extract_order_events_meesho()    — from Meesho "Order Payments" sheet
  extract_order_events_snapdeal_cpr() — from Snapdeal CPR flat sheet

Intelligence Engine (called after every upload):
  compute_sku_risk_scores()        — Z-score based risk per SKU per platform
  get_fraud_dashboard()            — aggregated view for UI

Status normalisation across all platforms → DELIVERED | RETURNED | RTO |
  CANCELLED | PENDING_RETURN | IN_TRANSIT
Payment mode normalisation → prepaid | postpaid | unknown
"""

from __future__ import annotations
from datetime import datetime, date
from typing import Optional
import math
import json

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func, text

from app.models.fraud import OrderEvent, SkuRiskScore, FraudAlert
from app.models.pnl import PnlReport
from app.models.platform import Platform
from app.models.sku import SkuPricing, SkuPlatformConfig


# ── Status normalisation maps ─────────────────────────────────────────────────

_FK_STATUS_MAP = {
    "DELIVERED":        "DELIVERED",
    "RETURNED":         "RETURNED",
    "CANCELLED":        "CANCELLED",
    "RETURN_REQUESTED": "PENDING_RETURN",
    "RETURN_CANCELLED": "DELIVERED",      # return rejected; item stays with buyer
}

_MEESHO_STATUS_MAP = {
    "Delivered":  "DELIVERED",
    "Return":     "RETURNED",
    "RTO":        "RTO",
    "Cancelled":  "CANCELLED",
    "Shipped":    "IN_TRANSIT",
}

_CPR_STATUS_MAP = {
    "Delivered":        "DELIVERED",
    "Courier Return":   "RTO",
    "Customer Return":  "RETURNED",
    "Seller Cancelled": "CANCELLED",
    "Courier Cancelled": "CANCELLED",
    "Shipped":          "IN_TRANSIT",
    "To be Shipped":    "IN_TRANSIT",
}

_FK_PAYMENT_MAP = {
    "prepaid":     "prepaid",
    "postpaid":    "postpaid",    # COD-equivalent on FK
    "part_payment": "postpaid",
}


# ── Return reason intelligence ────────────────────────────────────────────────

# FK return_reason → fraud signal classification
_RETURN_REASON_CLASSIFIER: dict[str, str] = {
    # Fraud signals — customer exploiting policy
    "ORC_validated_with_customer":  "FRAUD_SIGNAL",
    "MISSHIPMENT":                  "FRAUD_SIGNAL",
    "MISSING_ITEM":                 "FRAUD_SIGNAL",
    "DIFFERENT_PRODUCT_RECEIVED":   "FRAUD_SIGNAL",
    "USED_PRODUCT":                 "FRAUD_SIGNAL",
    "ITEM_NOT_RECEIVED":            "FRAUD_SIGNAL",
    "DAMAGED_IN_TRANSIT":           "LOGISTICS",
    "QUALITY_ISSUE":                "QUALITY",
    "CUSTOMER_REMORSE":             "PREFERENCE",
    "SIZE_FIT_ISSUES":              "PREFERENCE",
    "SIZE_FIT_ISSUE":               "PREFERENCE",
    "COLOR_VARIANT_ISSUE":          "PREFERENCE",
    "PRODUCT_NOT_AS_DESCRIBED":     "QUALITY",
    "delivery_time_long":           "LOGISTICS",
    "NOT_AS_DESCRIBED":             "QUALITY",
    "WRONG_ADDRESS":                "LOGISTICS",
}

_RETURN_SUB_REASON_OVERRIDES: dict[str, str] = {
    "STOLEN":       "FRAUD_SIGNAL",
    "EMPTY_BOX":    "FRAUD_SIGNAL",
    "FAKE_PRODUCT": "FRAUD_SIGNAL",
    "SECOND_HAND":  "FRAUD_SIGNAL",
    "TAMPERED":     "FRAUD_SIGNAL",
    "NOT_RECEIVED": "FRAUD_SIGNAL",
}


def classify_fraud_signal(return_reason: Optional[str], return_sub_reason: Optional[str]) -> Optional[str]:
    """
    Classify a return reason into fraud signal category.
    Sub-reason overrides take priority over reason.
    Returns: FRAUD_SIGNAL | QUALITY | PREFERENCE | LOGISTICS | None
    """
    if return_sub_reason:
        key = str(return_sub_reason).strip().upper().replace(" ", "_")
        if key in _RETURN_SUB_REASON_OVERRIDES:
            return _RETURN_SUB_REASON_OVERRIDES[key]
    if return_reason:
        key = str(return_reason).strip()
        if key in _RETURN_REASON_CLASSIFIER:
            return _RETURN_REASON_CLASSIFIER[key]
        key_lower = key.lower()
        if any(w in key_lower for w in ["fraud", "stolen", "empty", "fake", "tamper"]):
            return "FRAUD_SIGNAL"
        if any(w in key_lower for w in ["quality", "defect", "broken", "damage"]):
            return "QUALITY"
        if any(w in key_lower for w in ["size", "fit", "colour", "color", "remorse", "change"]):
            return "PREFERENCE"
        if any(w in key_lower for w in ["logistic", "transit", "delivery", "address", "courier"]):
            return "LOGISTICS"
    return None


# ── Snapdeal geographic intelligence ─────────────────────────────────────────

SNAPDEAL_STATE_MAP: dict[str, str] = {
    "01": "Jammu & Kashmir",
    "02": "Himachal Pradesh",
    "03": "Punjab",
    "04": "Chandigarh",
    "05": "Uttarakhand",
    "06": "Haryana",
    "07": "Delhi",
    "08": "Rajasthan",
    "09": "Uttar Pradesh",
    "10": "Bihar",
    "11": "Sikkim",
    "12": "Arunachal Pradesh",
    "13": "Nagaland",
    "14": "Manipur",
    "15": "Mizoram",
    "16": "Tripura",
    "17": "Meghalaya",
    "18": "Assam",
    "19": "West Bengal",
    "20": "Jharkhand",
    "21": "Odisha",
    "22": "Chhattisgarh",
    "23": "Madhya Pradesh",
    "24": "Gujarat",
    "25": "Daman & Diu",
    "26": "Dadra & Nagar Haveli",
    "27": "Maharashtra",
    "28": "Andhra Pradesh (old)",
    "29": "Karnataka",
    "30": "Goa",
    "31": "Lakshadweep",
    "32": "Kerala",
    "33": "Tamil Nadu",
    "34": "Puducherry",
    "35": "Andaman & Nicobar",
    "36": "Telangana",
    "37": "Andhra Pradesh",
    "38": "Ladakh",
}


def resolve_state(raw_code) -> tuple[Optional[str], Optional[str]]:
    """
    Resolve Snapdeal Customer State value (numeric GST code) to (code_str, state_name).
    Input may be int (23), float (23.0), or str ("23" / "23.0").
    Returns (None, None) if unresolvable.
    """
    if raw_code is None:
        return None, None
    try:
        code_str = str(int(float(str(raw_code)))).zfill(2)
        name = SNAPDEAL_STATE_MAP.get(code_str)
        return (code_str, name) if name else (code_str, None)
    except (ValueError, TypeError):
        return None, None


# ── Date / velocity helpers ───────────────────────────────────────────────────

def _compute_velocity_days(
    delivery_date,
    return_pickup_date,
) -> Optional[int]:
    """
    Days from delivery to return pickup.
    Returns None if delivery_date is None or return happened before delivery.
    """
    if delivery_date is None or return_pickup_date is None:
        return None
    try:
        delta = (return_pickup_date - delivery_date).days
        return delta if delta >= 0 else None
    except Exception:
        return None


def _parse_date_col(value) -> Optional[date]:
    """Safely parse a date value from Excel (timestamp or string)."""
    if value is None:
        return None
    if hasattr(value, "date"):
        return value.date()
    try:
        import pandas as pd
        d = pd.to_datetime(value, errors="coerce")
        return d.date() if not pd.isna(d) else None
    except Exception:
        return None


# ── FK order extraction ───────────────────────────────────────────────────────

def extract_order_events_fk(file_bytes: bytes) -> list[dict]:
    """
    Extract per-order rows from FK 'Orders P&L' sheet.
    Row 0 = headers, Row 1 = sub-headers (skipped), Row 2+ = data.
    Returns list of dicts ready for OrderEvent insertion.
    """
    from io import BytesIO
    import pandas as pd
    import warnings
    warnings.filterwarnings("ignore", category=UserWarning)

    df = pd.read_excel(
        BytesIO(file_bytes), sheet_name="Orders P&L",
        header=0,
        skiprows=lambda i: i == 1,   # skip sub-header row
    )

    # Normalise column names: strip whitespace
    df.columns = [str(c).strip() for c in df.columns]

    # Drop rows where Order ID is null (footer rows)
    df = df[df["Order ID"].notna()]

    # Identify sale + settlement columns by partial name
    sale_col = next((c for c in df.columns if "Accounted Net Sales" in c and "(INR)" in c), None)
    bs_col   = next((c for c in df.columns if "Bank Settlement" in c and "Projected" in c and ".1" not in c), None)

    events: list[dict] = []
    for _, row in df.iterrows():
        raw_status = str(row.get("Order Status", "")).strip()
        raw_payment = str(row.get("Mode of Payment", "")).strip().lower()
        order_date = row.get("Order Date")
        if hasattr(order_date, 'date'):
            order_date = order_date.date()
        elif isinstance(order_date, str):
            try:
                order_date = pd.to_datetime(order_date, errors="coerce").date()
            except Exception:
                order_date = None

        sale_val = None
        if sale_col:
            v = pd.to_numeric(row.get(sale_col), errors="coerce")
            sale_val = float(v) if not (v is None or (isinstance(v, float) and math.isnan(v))) else None

        bs_val = None
        if bs_col:
            v = pd.to_numeric(row.get(bs_col), errors="coerce")
            bs_val = float(v) if not (v is None or (isinstance(v, float) and math.isnan(v))) else None

        events.append({
            "external_order_id": str(row.get("Order ID", "")).strip(),
            "sku_platform_name":  str(row.get("SKU Name", "")).strip(),
            "order_date":         order_date,
            "order_status":       _FK_STATUS_MAP.get(raw_status, raw_status or "UNKNOWN"),
            "payment_mode":       _FK_PAYMENT_MAP.get(raw_payment, "unknown"),
            "sale_amount":        sale_val,
            "settled_amount":     bs_val,
        })

    return [e for e in events if e["sku_platform_name"]]


# ── FK Orders file extraction (flipkarrttt.xlsx "Orders" sheet) ──────────────

def extract_order_events_fk_orders(file_bytes: bytes) -> list[dict]:
    """
    Extract per-order rows from Flipkart Orders file (NOT the P&L file).
    File: flipkarrttt.xlsx — sheet: "Orders"

    Columns: order_item_id, order_id, order_item_status, sku,
             order_date, order_delivery_date, order_return_approval_date,
             return_reason, return_sub_reason, cancellation_reason, dispatched_date

    Velocity: (order_return_approval_date - order_delivery_date).days
    Fraud signal: classify_fraud_signal() on returned orders only
    """
    from io import BytesIO
    import pandas as pd
    import warnings
    warnings.filterwarnings("ignore", category=UserWarning)

    try:
        df = pd.read_excel(BytesIO(file_bytes), sheet_name="Orders", header=0)
    except Exception:
        df = pd.read_excel(BytesIO(file_bytes), sheet_name=0, header=0)

    df.columns = [str(c).strip().lower().replace(" ", "_") for c in df.columns]

    # Drop rows with no order identity
    id_col = next((c for c in df.columns if "order_item_id" in c or "order_id" in c), None)
    if id_col:
        df = df[df[id_col].notna()]

    _STATUS_FK_ORDERS = {
        "DELIVERED":        "DELIVERED",
        "CANCELLED":        "CANCELLED",
        "RETURNED":         "RETURNED",
        "RETURN_REQUESTED": "PENDING_RETURN",
        "RETURN_CANCELLED": "DELIVERED",
        "SHIPPED":          "IN_TRANSIT",
    }

    events: list[dict] = []
    for _, row in df.iterrows():
        sku = str(row.get("sku", "")).strip()
        if not sku or sku == "nan":
            continue

        order_item_id = str(row.get("order_item_id", "")).strip()
        order_id      = str(row.get("order_id", "")).strip()

        raw_status  = str(row.get("order_item_status", "")).strip().upper()
        norm_status = _STATUS_FK_ORDERS.get(raw_status, raw_status or "UNKNOWN")

        order_date    = _parse_date_col(row.get("order_date"))
        delivery_date = _parse_date_col(row.get("order_delivery_date"))
        return_date   = _parse_date_col(row.get("order_return_approval_date"))
        dispatch_date = _parse_date_col(row.get("dispatched_date"))

        velocity_days = _compute_velocity_days(delivery_date, return_date)

        return_reason       = str(row.get("return_reason", "")).strip() or None
        return_sub_reason   = str(row.get("return_sub_reason", "")).strip() or None
        cancellation_reason = str(row.get("cancellation_reason", "")).strip() or None

        # Clean "nan" strings
        if return_reason == "nan":       return_reason = None
        if return_sub_reason == "nan":   return_sub_reason = None
        if cancellation_reason == "nan": cancellation_reason = None

        fraud_signal = None
        if norm_status == "RETURNED":
            fraud_signal = classify_fraud_signal(return_reason, return_sub_reason)

        events.append({
            "external_order_id":    order_item_id or order_id,
            "sku_platform_name":    sku,
            "order_date":           order_date,
            "dispatch_date":        dispatch_date,
            "delivery_date":        delivery_date,
            "return_pickup_date":   return_date,
            "return_velocity_days": velocity_days,
            "order_status":         norm_status,
            "payment_mode":         "unknown",
            "sale_amount":          None,
            "settled_amount":       None,
            "commission_charged":   None,
            "return_reason":        return_reason,
            "return_sub_reason":    return_sub_reason,
            "cancellation_reason":  cancellation_reason,
            "fraud_signal_type":    fraud_signal,
            "customer_state_code":  None,
            "customer_state_name":  None,
            "is_cod":               None,
        })

    return events


# ── Meesho order extraction ───────────────────────────────────────────────────

def extract_order_events_meesho(file_bytes: bytes) -> list[dict]:
    """
    Extract per-order rows from Meesho 'Order Payments' sheet.
    Extracts 'Dispatch Date' → dispatch_date, 'Payment Date' → delivery_date field
    (Meesho Payment Date = settlement date from Meesho to seller, NOT actual delivery date).
    """
    from io import BytesIO
    import pandas as pd
    import warnings
    warnings.filterwarnings("ignore", category=UserWarning)

    df = pd.read_excel(BytesIO(file_bytes), sheet_name="Order Payments", skiprows=[0, 2], header=0)
    df = df[df["Sub Order No"].notna()]

    events: list[dict] = []
    for _, row in df.iterrows():
        raw_status    = str(row.get("Live Order Status", "")).strip()
        order_date    = _parse_date_col(row.get("Order Date"))
        dispatch_date = _parse_date_col(row.get("Dispatch Date"))
        payment_date  = _parse_date_col(row.get("Payment Date"))   # settlement/payment date from Meesho

        norm_status   = _MEESHO_STATUS_MAP.get(raw_status, raw_status or "UNKNOWN")

        sale_v = pd.to_numeric(row.get("Total Sale Amount (Incl. Shipping & GST)"), errors="coerce")
        sett_v = pd.to_numeric(row.get("Final Settlement Amount"), errors="coerce")

        events.append({
            "external_order_id":    str(row.get("Sub Order No", "")).strip(),
            "sku_platform_name":    str(row.get("Supplier SKU", "")).strip(),
            "order_date":           order_date,
            "dispatch_date":        dispatch_date,
            "delivery_date":        payment_date,   # Meesho Payment Date = settlement date (NOT delivery); no real delivery date available
            "return_pickup_date":   None,
            "return_velocity_days": None,
            "order_status":         norm_status,
            "payment_mode":         "prepaid",
            "sale_amount":          float(sale_v) if pd.notna(sale_v) else None,
            "settled_amount":       float(sett_v) if pd.notna(sett_v) else None,
            "commission_charged":   None,
        })

    return [e for e in events if e["sku_platform_name"]]


# ── Snapdeal CPR order extraction ─────────────────────────────────────────────

def extract_order_events_snapdeal_cpr(file_bytes: bytes) -> list[dict]:
    """
    Extract per-suborder rows from Snapdeal CPR flat sheet.
    Extracts del_date → delivery_date, RPU_date → return_pickup_date,
    computes return_velocity_days, extracts 'Net Charged Fee' → commission_charged.
    """
    from io import BytesIO
    import pandas as pd
    import warnings
    warnings.filterwarnings("ignore", category=UserWarning)

    df = pd.read_excel(BytesIO(file_bytes), sheet_name=0)
    df = df[df["SubOrder Code"].notna()]
    df.columns = [str(c).strip() for c in df.columns]

    events: list[dict] = []
    for _, row in df.iterrows():
        raw_status  = str(row.get("Order Status", "")).strip()
        order_date  = _parse_date_col(row.get("order_date"))
        del_date    = _parse_date_col(row.get("del_date"))
        rpu_date    = _parse_date_col(row.get("RPU_date"))
        rto_date    = _parse_date_col(row.get("rto_date"))

        norm_status = _CPR_STATUS_MAP.get(raw_status, raw_status or "UNKNOWN")

        # Use RPU date for customer returns, RTO date for logistics returns
        return_pickup = rpu_date if norm_status == "RETURNED" else (rto_date if norm_status == "RTO" else None)
        velocity_days = _compute_velocity_days(del_date, return_pickup)

        sale_v = pd.to_numeric(row.get("Order Amount"), errors="coerce")
        sett_v = pd.to_numeric(row.get("Settled"), errors="coerce")
        fee_v  = pd.to_numeric(row.get("Net Charged Fee"), errors="coerce")

        pay_status   = str(row.get("Payment Status", "")).lower()
        payment_mode = "postpaid" if "cod" in pay_status else "prepaid"

        events.append({
            "external_order_id":    str(row.get("SubOrder Code", "")).strip(),
            "sku_platform_name":    str(row.get("SKU", "")).strip(),
            "order_date":           order_date,
            "dispatch_date":        None,
            "delivery_date":        del_date,
            "return_pickup_date":   return_pickup,
            "return_velocity_days": velocity_days,
            "order_status":         norm_status,
            "payment_mode":         payment_mode,
            "sale_amount":          float(sale_v) if pd.notna(sale_v) else None,
            "settled_amount":       float(sett_v) if pd.notna(sett_v) else None,
            "commission_charged":   float(fee_v)  if pd.notna(fee_v)  else None,
        })

    return [e for e in events if e["sku_platform_name"]]


# ── Snapdeal Total_Suboders extraction (snapdeal.xlsx) ────────────────────────

def extract_order_events_snapdeal_total(file_bytes: bytes) -> dict[str, dict]:
    """
    Extract customer state + COD flag from Snapdeal 'Total_Suboders' sheet.
    Returns a dict keyed by Sub Order No for merging with CPR events.
    Customer State = numeric GST code → resolve to state name.
    Transaction Type: 'COD Vendor Invoice' = COD order, 'NCOD Vendor Invoice' = prepaid.
    """
    from io import BytesIO
    import pandas as pd
    import warnings
    warnings.filterwarnings("ignore", category=UserWarning)

    try:
        df = pd.read_excel(BytesIO(file_bytes), sheet_name="Total_Suboders", header=0)
    except Exception:
        return {}

    df.columns = [str(c).strip() for c in df.columns]

    # Find the Sub Order No column
    sub_col = next((c for c in df.columns if "Sub Order" in c or "Sub_Order" in c), None)
    if sub_col is None:
        return {}

    df = df[df[sub_col].notna()]

    result: dict[str, dict] = {}
    for _, row in df.iterrows():
        sub_order = str(row.get(sub_col, "")).strip()
        if not sub_order or sub_order == "nan":
            continue

        raw_state = row.get("Customer State")
        state_code, state_name = resolve_state(raw_state)

        tx_type = str(row.get("Transaction Type", "")).strip().upper()
        is_cod = "COD" in tx_type and "NCOD" not in tx_type

        result[sub_order] = {
            "customer_state_code": state_code,
            "customer_state_name": state_name,
            "is_cod": is_cod,
        }

    return result


# ── Build pricing lookup for order events ─────────────────────────────────────

async def _build_sku_lookup(session: AsyncSession, platform_id: int) -> dict[str, int]:
    """Return map: sku_platform_name.upper() → sku_pricing_id."""
    result = await session.execute(
        select(SkuPlatformConfig).where(
            SkuPlatformConfig.platform_id == platform_id,
            SkuPlatformConfig.platform_sku_name.isnot(None),
        )
    )
    configs = result.scalars().all()
    return {
        c.platform_sku_name.strip().upper(): c.sku_pricing_id
        for c in configs
        if c.platform_sku_name and c.sku_pricing_id
    }


# ── Store order events ────────────────────────────────────────────────────────

async def store_order_events(
    session: AsyncSession,
    events: list[dict],
    report_id: int,
    platform_id: int,
) -> int:
    """Persist order events. Returns count stored."""
    if not events:
        return 0

    sku_lookup = await _build_sku_lookup(session, platform_id)

    for ev in events:
        pricing_id = sku_lookup.get(ev["sku_platform_name"].upper())
        obj = OrderEvent(
            report_id=report_id,
            platform_id=platform_id,
            sku_pricing_id=pricing_id,
            external_order_id=ev.get("external_order_id"),
            sku_platform_name=ev["sku_platform_name"],
            order_date=ev.get("order_date"),
            dispatch_date=ev.get("dispatch_date"),
            delivery_date=ev.get("delivery_date"),
            return_pickup_date=ev.get("return_pickup_date"),
            return_velocity_days=ev.get("return_velocity_days"),
            commission_charged=ev.get("commission_charged"),
            order_status=ev["order_status"],
            payment_mode=ev.get("payment_mode"),
            sale_amount=ev.get("sale_amount"),
            settled_amount=ev.get("settled_amount"),
            return_reason       = ev.get("return_reason"),
            return_sub_reason   = ev.get("return_sub_reason"),
            cancellation_reason = ev.get("cancellation_reason"),
            fraud_signal_type   = ev.get("fraud_signal_type"),
            customer_state_code = ev.get("customer_state_code"),
            customer_state_name = ev.get("customer_state_name"),
            is_cod              = ev.get("is_cod"),
        )
        session.add(obj)

    return len(events)


# ── Intelligence Engine ───────────────────────────────────────────────────────

def _classify_alert_severity(
    alert_type: str,
    amount: Optional[float] = None,
    velocity_days: Optional[int] = None,
) -> str:
    """Map alert type + evidence to severity level."""
    if alert_type == "SETTLEMENT_GAP":
        if amount and abs(amount) >= 5000: return "CRITICAL"
        if amount and abs(amount) >= 2000: return "HIGH"
        return "MEDIUM"
    if alert_type == "COD_ABUSE":
        return "HIGH"
    if alert_type == "VELOCITY_FRAUD":
        if velocity_days is not None and velocity_days == 0: return "CRITICAL"
        return "HIGH"
    if alert_type == "FEE_OVERCHARGE":
        if amount and abs(amount) >= 5000: return "CRITICAL"
        return "HIGH"
    if alert_type == "ESCALATING_RISK":
        return "MEDIUM"
    if alert_type == "RETURN_SPIKE":
        return "LOW"
    if alert_type == "CROSS_PLATFORM_RISK":
        return "MEDIUM"
    return "LOW"


def _settlement_gap_severity(gap: float, pct: float) -> Optional[str]:
    """
    gap = actual_bs - expected_bs (negative = platform underpaid/overcharged)
    Returns severity if gap is meaningful, None if not actionable.
    """
    if gap >= 0:
        return None   # Positive gap = fine, platform paid more than expected
    if abs(pct) >= 0.10 or abs(gap) >= 5000:
        return "CRITICAL"
    if abs(pct) >= 0.05 or abs(gap) >= 2000:
        return "HIGH"
    if abs(pct) >= 0.02 or abs(gap) >= 500:
        return "MEDIUM"
    return None   # Too small to alert


def _risk_tier(z_score: Optional[float], combined_loss_rate: Optional[float]) -> str:
    """
    Classify risk tier using Z-score + absolute loss rate.
    Z-score measures how far above platform average this SKU is.
    combined_loss_rate = (returned + rto) / gross
    """
    z  = z_score or 0.0
    cr = combined_loss_rate or 0.0

    if z >= 2.0 or cr >= 0.50:
        return "CRITICAL"
    if z >= 1.0 or cr >= 0.35:
        return "RED"
    if z >= 0.5 or cr >= 0.20:
        return "AMBER"
    return "GREEN"


def _trend(current_rate: float, prev_rate: Optional[float]) -> str:
    if prev_rate is None:
        return "STABLE"
    delta = current_rate - prev_rate
    if delta > 0.05:
        return "WORSENING"
    if delta < -0.05:
        return "IMPROVING"
    return "STABLE"


def _velocity_stats(velocity_days_list: list) -> dict:
    """
    Compute velocity intelligence from a list of return-velocity-days values.
    velocity_fraud_count = orders returned in <= 3 days from delivery (suspicious).
    """
    if not velocity_days_list:
        return {"avg_velocity": None, "velocity_fraud_count": 0}
    avg = round(sum(velocity_days_list) / len(velocity_days_list), 1)
    fraud_count = sum(1 for v in velocity_days_list if v <= 3)
    return {"avg_velocity": avg, "velocity_fraud_count": fraud_count}


def _composite_fraud_score(
    z_score: float,
    velocity_fraud_pct: float,
    cod_abuse: bool,
    settlement_gap_pct: float,
    fee_overcharge_pct: float,
) -> float:
    """
    Composite 0-100 fraud intelligence score.
    Weights:
      Z-score component    (0-30): statistical anomaly vs platform peers
      Velocity component   (0-25): % returns in <= 3 days of delivery
      COD abuse component  (0-20): COD return rate significantly > prepaid rate
      Settlement gap       (0-15): platform underpaying vs Casper expected BS
      Fee overcharge       (0-10): platform charging more than contracted rate
    """
    z_component   = min(30.0, max(0.0, z_score * 10.0))
    v_component   = min(25.0, velocity_fraud_pct * 50.0)
    cod_component = 20.0 if cod_abuse else 0.0
    s_component   = min(15.0, abs(settlement_gap_pct) * 100.0)
    f_component   = min(10.0, abs(fee_overcharge_pct) * 50.0)
    return round(min(100.0, z_component + v_component + cod_component + s_component + f_component), 1)


async def compute_sku_risk_scores(session: AsyncSession, platform_id: int) -> int:
    """
    Recompute all SkuRiskScore rows for a platform after an upload.
    1. Pull all order_events for this platform
    2. Group by sku_platform_name
    3. Compute rates + Z-score + risk tier
    4. Delete old scores + insert fresh ones
    Returns count of SKUs scored.
    """
    # Pull all events for this platform
    result = await session.execute(
        select(OrderEvent).where(OrderEvent.platform_id == platform_id)
    )
    events = result.scalars().all()

    if not events:
        return 0

    # Group by SKU
    from collections import defaultdict
    sku_events: dict[str, list[OrderEvent]] = defaultdict(list)
    for ev in events:
        sku_events[ev.sku_platform_name].append(ev)

    # Compute per-SKU stats
    stats: list[dict] = []
    for sku_name, evs in sku_events.items():
        gross         = len(evs)
        delivered     = sum(1 for e in evs if e.order_status == "DELIVERED")
        returned      = sum(1 for e in evs if e.order_status == "RETURNED")
        rto           = sum(1 for e in evs if e.order_status == "RTO")
        cancelled     = sum(1 for e in evs if e.order_status == "CANCELLED")
        pending_ret   = sum(1 for e in evs if e.order_status == "PENDING_RETURN")
        in_transit    = sum(1 for e in evs if e.order_status == "IN_TRANSIT")

        # Rates (denominator = gross excluding cancelled — cancelled aren't shipped)
        denom = gross - cancelled
        return_rate  = round(returned / denom, 4) if denom > 0 else 0.0
        rto_rate     = round(rto / denom, 4)      if denom > 0 else 0.0
        canc_rate    = round(cancelled / gross, 4) if gross > 0 else 0.0
        combined     = round((returned + rto) / denom, 4) if denom > 0 else 0.0

        # Payment mode split (FK has prepaid/postpaid; others mostly prepaid)
        prepaid_evs  = [e for e in evs if e.payment_mode == "prepaid" and e.order_status in ("DELIVERED", "RETURNED", "RTO", "PENDING_RETURN")]
        postpaid_evs = [e for e in evs if e.payment_mode == "postpaid" and e.order_status in ("DELIVERED", "RETURNED", "RTO", "PENDING_RETURN")]

        def _payment_return_rate(pay_evs):
            if not pay_evs:
                return None
            pay_denom = len(pay_evs) - sum(1 for e in pay_evs if e.order_status == "CANCELLED")
            if pay_denom <= 0:
                return None
            return round(sum(1 for e in pay_evs if e.order_status in ("RETURNED", "RTO")) / pay_denom, 4)

        prepaid_rr  = _payment_return_rate(prepaid_evs)
        postpaid_rr = _payment_return_rate(postpaid_evs)
        cod_abuse   = bool(
            prepaid_rr is not None and postpaid_rr is not None
            and (postpaid_rr - prepaid_rr) > 0.20
        )

        # Revenue
        sale_amounts = [e.sale_amount for e in evs if e.sale_amount is not None and e.sale_amount > 0]
        avg_sale     = round(sum(sale_amounts) / len(sale_amounts), 2) if sale_amounts else None
        total_rev    = round(sum(sale_amounts), 2) if sale_amounts else None
        rev_at_risk  = round(pending_ret * avg_sale, 2) if (avg_sale and pending_ret > 0) else 0.0

        # Pricing ID (use first matched event's)
        pricing_id   = next((e.sku_pricing_id for e in evs if e.sku_pricing_id), None)

        # ── Velocity intelligence ──────────────────────────────────────────
        returned_with_velocity = [
            e.return_velocity_days
            for e in evs
            if e.order_status in ("RETURNED", "RTO") and e.return_velocity_days is not None
        ]
        vel_stats = _velocity_stats(returned_with_velocity)
        vel_pct   = vel_stats["velocity_fraud_count"] / max(1, returned + rto)

        # ── Fee overcharge intelligence ────────────────────────────────────
        fees    = [e.commission_charged for e in evs if e.commission_charged is not None]
        sales_  = [e.sale_amount        for e in evs if e.sale_amount is not None and e.sale_amount > 0]
        fee_overcharge_amt  = None
        fee_overcharge_pct_ = 0.0
        if fees and sales_:
            avg_fee   = sum(fees) / len(fees)
            avg_sale_ = sum(sales_) / len(sales_)
            if avg_sale_ > 0:
                actual_fee_pct   = avg_fee / avg_sale_
                expected_fee_pct = 0.22    # Snapdeal max contracted ~22%
                if actual_fee_pct > expected_fee_pct:
                    fee_overcharge_pct_ = actual_fee_pct - expected_fee_pct
                    fee_overcharge_amt  = round(fee_overcharge_pct_ * sum(sales_), 2)

        stats.append({
            "sku_platform_name":      sku_name,
            "sku_pricing_id":         pricing_id,
            "gross_orders":           gross,
            "delivered_orders":       delivered,
            "returned_orders":        returned,
            "rto_orders":             rto,
            "cancelled_orders":       cancelled,
            "pending_return_orders":  pending_ret,
            "in_transit_orders":      in_transit,
            "return_rate":            return_rate,
            "rto_rate":               rto_rate,
            "cancellation_rate":      canc_rate,
            "combined_loss_rate":     combined,
            "prepaid_return_rate":    prepaid_rr,
            "postpaid_return_rate":   postpaid_rr,
            "cod_abuse_flag":         cod_abuse,
            "avg_sale_amount":        avg_sale,
            "total_revenue":          total_rev,
            "revenue_at_risk":        rev_at_risk,
            "avg_return_velocity_days": vel_stats["avg_velocity"],
            "velocity_fraud_count":   vel_stats["velocity_fraud_count"],
            "fee_overcharge_amount":  fee_overcharge_amt,
            "_velocity_fraud_pct":    vel_pct,
            "_fee_overcharge_pct":    fee_overcharge_pct_,
        })

    # Platform-level statistics for Z-score
    loss_rates = [s["combined_loss_rate"] for s in stats if s["gross_orders"] >= 3]
    if len(loss_rates) >= 2:
        avg  = sum(loss_rates) / len(loss_rates)
        std  = math.sqrt(sum((x - avg) ** 2 for x in loss_rates) / len(loss_rates))
    else:
        avg = sum(loss_rates) / len(loss_rates) if loss_rates else 0.0
        std = 0.0

    # Delete old scores for this platform
    await session.execute(
        delete(SkuRiskScore).where(SkuRiskScore.platform_id == platform_id)
    )

    # Insert fresh scores
    now = datetime.utcnow()
    for s in stats:
        clr   = s["combined_loss_rate"]
        z     = round((clr - avg) / std, 3) if std > 0 else 0.0
        tier  = _risk_tier(z, clr)

        session.add(SkuRiskScore(
            sku_pricing_id=s["sku_pricing_id"],
            platform_id=platform_id,
            sku_platform_name=s["sku_platform_name"],
            computed_at=now,
            gross_orders=s["gross_orders"],
            delivered_orders=s["delivered_orders"],
            returned_orders=s["returned_orders"],
            rto_orders=s["rto_orders"],
            cancelled_orders=s["cancelled_orders"],
            pending_return_orders=s["pending_return_orders"],
            in_transit_orders=s["in_transit_orders"],
            return_rate=s["return_rate"],
            rto_rate=s["rto_rate"],
            cancellation_rate=s["cancellation_rate"],
            combined_loss_rate=clr,
            platform_avg_return_rate=round(avg, 4),
            platform_std_return_rate=round(std, 4),
            z_score=z,
            risk_tier=tier,
            trend_direction=_trend(clr, None),
            prepaid_return_rate=s["prepaid_return_rate"],
            postpaid_return_rate=s["postpaid_return_rate"],
            cod_abuse_flag=s["cod_abuse_flag"],
            avg_sale_amount=s["avg_sale_amount"],
            total_revenue=s["total_revenue"],
            revenue_at_risk=s["revenue_at_risk"],
            avg_return_velocity_days=s["avg_return_velocity_days"],
            velocity_fraud_count=s["velocity_fraud_count"],
            fee_overcharge_amount=s["fee_overcharge_amount"],
            composite_fraud_score=_composite_fraud_score(
                z_score=z,
                velocity_fraud_pct=s["_velocity_fraud_pct"],
                cod_abuse=s["cod_abuse_flag"],
                settlement_gap_pct=0.0,    # TODO: wire in from PnlSkuRow.variance_bs (15/100 points currently unused)
                fee_overcharge_pct=s["_fee_overcharge_pct"],
            ),
        ))

    return len(stats)


# ── Alert generation ──────────────────────────────────────────────────────────

async def generate_fraud_alerts(session: AsyncSession, platform_id: int, report_id: int) -> int:
    """
    Generate FraudAlert rows after an upload.
    Runs AFTER store_order_events() + compute_sku_risk_scores().
    Deletes old unresolved alerts for this platform before inserting fresh ones.
    Returns count of alerts generated.
    """
    from app.models.pnl import PnlSkuRow

    # Delete old unresolved alerts for this platform
    await session.execute(
        delete(FraudAlert).where(
            FraudAlert.platform_id == platform_id,
            FraudAlert.is_resolved == False,
        )
    )

    alerts: list[FraudAlert] = []
    now = datetime.utcnow()

    # ── 1. Settlement gap alerts (from PnlSkuRow.variance_bs) ──────────────────
    sku_rows_result = await session.execute(
        select(PnlSkuRow)
        .where(
            PnlSkuRow.report_id == report_id,
            PnlSkuRow.variance_bs.isnot(None),
            PnlSkuRow.casper_expected_bs.isnot(None),
        )
    )
    sku_rows = sku_rows_result.scalars().all()

    if sku_rows:
        total_gap = sum(r.variance_bs for r in sku_rows if r.variance_bs is not None)
        expected_sum = sum(r.casper_expected_bs for r in sku_rows if r.casper_expected_bs is not None)
        if total_gap < -500 and expected_sum != 0:
            pct_gap = total_gap / abs(expected_sum)
            sev = _settlement_gap_severity(total_gap, pct_gap)
            if sev:
                top_gaps = [
                    {"sku": r.platform_sku_name, "gap": round(r.variance_bs, 2)}
                    for r in sorted(sku_rows, key=lambda x: x.variance_bs or 0)[:5]
                    if r.variance_bs and r.variance_bs < -100
                ]
                alerts.append(FraudAlert(
                    platform_id=platform_id,
                    report_id=report_id,
                    alert_type="SETTLEMENT_GAP",
                    severity=sev,
                    title=f"Settlement shortfall of ₹{abs(int(total_gap)):,} detected",
                    body=(
                        f"Platform paid ₹{abs(int(total_gap)):,} less than your Casper target across "
                        f"{len([r for r in sku_rows if r.variance_bs and r.variance_bs < -100])} SKUs. "
                        f"Gap is {abs(pct_gap*100):.1f}% of expected settlement. "
                        "This could indicate fee calculation differences or pricing errors."
                    ),
                    evidence_json=json.dumps({
                        "total_gap": round(total_gap, 2),
                        "pct_gap": round(pct_gap, 4),
                        "sku_count": len(sku_rows),
                        "top_gaps": top_gaps,
                    }),
                    amount=total_gap,
                    created_at=now,
                ))

    # ── 2. COD abuse alerts (from SkuRiskScore) ────────────────────────────────
    cod_result = await session.execute(
        select(SkuRiskScore)
        .where(
            SkuRiskScore.platform_id == platform_id,
            SkuRiskScore.cod_abuse_flag == True,
        )
        .order_by(SkuRiskScore.z_score.desc().nullslast())
    )
    cod_skus = cod_result.scalars().all()

    for sku in cod_skus:
        pre  = sku.prepaid_return_rate or 0
        post = sku.postpaid_return_rate or 0
        diff = post - pre
        alerts.append(FraudAlert(
            platform_id=platform_id,
            report_id=report_id,
            alert_type="COD_ABUSE",
            severity="HIGH",
            title=f"COD abuse pattern: {sku.sku_platform_name}",
            body=(
                f"Postpaid (COD) return rate {post*100:.1f}% vs prepaid {pre*100:.1f}% "
                f"— a {diff*100:.1f}pp gap. Customers may be ordering COD with intent to return. "
                "Recommendation: restrict COD for this SKU."
            ),
            evidence_json=json.dumps({
                "prepaid_return_rate": round(pre, 4),
                "postpaid_return_rate": round(post, 4),
                "diff_pp": round(diff, 4),
                "gross_orders": sku.gross_orders,
                "z_score": sku.z_score,
            }),
            sku_platform_name=sku.sku_platform_name,
            amount=sku.revenue_at_risk,
            created_at=now,
        ))

    # ── VELOCITY_FRAUD alerts ─────────────────────────────────────────────
    vf_result = await session.execute(
        select(SkuRiskScore).where(
            SkuRiskScore.platform_id == platform_id,
            SkuRiskScore.velocity_fraud_count > 0,
        ).order_by(SkuRiskScore.velocity_fraud_count.desc())
    )
    vf_skus = vf_result.scalars().all()

    for s in vf_skus[:5]:
        fraud_pct = round(
            s.velocity_fraud_count / max(1, (s.returned_orders or 0) + (s.rto_orders or 0)) * 100, 1
        )
        avg_vel = f"{s.avg_return_velocity_days:.1f}" if s.avg_return_velocity_days is not None else "?"

        fastest_result = await session.execute(
            select(OrderEvent).where(
                OrderEvent.platform_id == platform_id,
                OrderEvent.report_id == report_id,
                OrderEvent.sku_platform_name == s.sku_platform_name,
                OrderEvent.return_velocity_days.isnot(None),
                OrderEvent.return_velocity_days <= 3,
            ).order_by(OrderEvent.return_velocity_days.asc()).limit(1)
        )
        fastest = fastest_result.scalars().first()
        min_days = fastest.return_velocity_days if fastest else None

        sev = _classify_alert_severity("VELOCITY_FRAUD", velocity_days=min_days)
        alert = FraudAlert(
            platform_id=platform_id,
            report_id=report_id,
            alert_type="VELOCITY_FRAUD",
            severity=sev,
            title=f"Rapid-return pattern: {s.sku_platform_name}",
            body=(
                f"{s.velocity_fraud_count} orders returned within 3 days of delivery "
                f"({fraud_pct}% of returns). Average return velocity: {avg_vel} days. "
                f"Fastest return: {min_days} day(s). "
                f"Indicates possible item-not-delivered fraud or logistics misclassification."
            ),
            evidence_json=json.dumps({
                "velocity_fraud_count": s.velocity_fraud_count,
                "avg_velocity_days": s.avg_return_velocity_days,
                "fastest_return_days": min_days,
                "fraud_pct_of_returns": fraud_pct,
            }),
            sku_platform_name=s.sku_platform_name,
            amount=s.revenue_at_risk,
        )
        alerts.append(alert)
        session.add(alert)

    # ── FEE_OVERCHARGE alerts ─────────────────────────────────────────────
    fo_result = await session.execute(
        select(SkuRiskScore).where(
            SkuRiskScore.platform_id == platform_id,
            SkuRiskScore.fee_overcharge_amount > 100,
        ).order_by(SkuRiskScore.fee_overcharge_amount.desc())
    )
    fo_skus = fo_result.scalars().all()

    for s in fo_skus[:3]:
        sev = _classify_alert_severity("FEE_OVERCHARGE", amount=s.fee_overcharge_amount)
        alert = FraudAlert(
            platform_id=platform_id,
            report_id=report_id,
            alert_type="FEE_OVERCHARGE",
            severity=sev,
            title=f"Fee overcharge detected: {s.sku_platform_name}",
            body=(
                f"Platform commission exceeded contracted rate for {s.sku_platform_name}. "
                f"Estimated overcharge: ₹{round(s.fee_overcharge_amount):,}. "
                f"Review actual fee breakdown vs your Seller Agreement."
            ),
            evidence_json=json.dumps({
                "fee_overcharge_amount": s.fee_overcharge_amount,
                "sku": s.sku_platform_name,
            }),
            sku_platform_name=s.sku_platform_name,
            amount=s.fee_overcharge_amount,
        )
        alerts.append(alert)
        session.add(alert)

    # ── 3. Return spike alerts (CRITICAL/RED non-COD SKUs) ─────────────────────
    critical_result = await session.execute(
        select(SkuRiskScore)
        .where(
            SkuRiskScore.platform_id == platform_id,
            SkuRiskScore.risk_tier.in_(["CRITICAL", "RED"]),
            SkuRiskScore.cod_abuse_flag == False,
        )
        .order_by(SkuRiskScore.z_score.desc().nullslast())
        .limit(10)
    )
    critical_skus = critical_result.scalars().all()

    for sku in critical_skus:
        if (sku.z_score or 0) >= 1.0:
            alerts.append(FraudAlert(
                platform_id=platform_id,
                report_id=report_id,
                alert_type="RETURN_SPIKE",
                severity="CRITICAL" if sku.risk_tier == "CRITICAL" else "MEDIUM",
                title=f"High return rate: {sku.sku_platform_name}",
                body=(
                    f"Combined loss rate {(sku.combined_loss_rate or 0)*100:.1f}% — "
                    f"{(sku.z_score or 0):.1f}σ above platform average "
                    f"({(sku.platform_avg_return_rate or 0)*100:.1f}%). "
                    f"{sku.returned_orders} returns + {sku.rto_orders} RTOs from {sku.gross_orders} orders."
                ),
                evidence_json=json.dumps({
                    "combined_loss_rate": sku.combined_loss_rate,
                    "z_score": sku.z_score,
                    "platform_avg": sku.platform_avg_return_rate,
                    "returned": sku.returned_orders,
                    "rto": sku.rto_orders,
                    "gross": sku.gross_orders,
                }),
                sku_platform_name=sku.sku_platform_name,
                amount=sku.revenue_at_risk,
                created_at=now,
            ))

    for a in alerts:
        session.add(a)

    return len(alerts)


# ── Overview + per-platform views ─────────────────────────────────────────────

async def get_fraud_overview(session: AsyncSession) -> dict:
    """Verdict + top alerts + platform health summary."""
    sev_order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}

    alerts_result = await session.execute(
        select(FraudAlert, Platform.name.label("platform_name"))
        .join(Platform, FraudAlert.platform_id == Platform.id)
        .where(FraudAlert.is_resolved == False)
        .order_by(FraudAlert.created_at.desc())
    )
    alert_rows = alerts_result.all()

    alerts_sorted = sorted(
        alert_rows,
        key=lambda r: (sev_order.get(r[0].severity, 9), r[0].created_at)
    )

    alerts_out = [
        {
            "id":            a.id,
            "alert_type":    a.alert_type,
            "severity":      a.severity,
            "title":         a.title,
            "body":          a.body,
            "platform_name": pname,
            "sku_platform_name": a.sku_platform_name,
            "amount":        a.amount,
            "created_at":    a.created_at.isoformat(),
        }
        for a, pname in alerts_sorted
    ]

    critical_count = sum(1 for a, _ in alert_rows if a.severity == "CRITICAL")
    high_count     = sum(1 for a, _ in alert_rows if a.severity == "HIGH")

    if critical_count > 0:
        verdict     = "CRITICAL"
        verdict_msg = f"{critical_count} critical issue{'s' if critical_count > 1 else ''} require immediate attention"
    elif high_count > 0:
        verdict     = "HIGH"
        verdict_msg = f"{high_count} high-priority issue{'s' if high_count > 1 else ''} detected"
    elif alerts_out:
        verdict     = "MEDIUM"
        verdict_msg = f"{len(alerts_out)} risk signals detected — review recommended"
    else:
        verdict     = "CLEAN"
        verdict_msg = "No active risk signals across all platforms"

    plat_result = await session.execute(select(Platform.id, Platform.name))
    platforms   = plat_result.all()

    platform_health = []
    for plat_id, plat_name in platforms:
        tier_result = await session.execute(
            select(SkuRiskScore.risk_tier, func.count(SkuRiskScore.id))
            .where(SkuRiskScore.platform_id == plat_id)
            .group_by(SkuRiskScore.risk_tier)
        )
        tiers     = {row[0]: row[1] for row in tier_result}
        total_skus = sum(tiers.values())
        if total_skus == 0:
            continue

        plat_alerts   = [a for a, pname in alert_rows if pname == plat_name]
        plat_critical = sum(1 for a in plat_alerts if a.severity == "CRITICAL")

        platform_health.append({
            "platform_id":     plat_id,
            "platform_name":   plat_name,
            "total_skus":      total_skus,
            "tier_summary":    tiers,
            "alert_count":     len(plat_alerts),
            "critical_alerts": plat_critical,
            "health_score":    max(0, 100 - (
                tiers.get("CRITICAL", 0) * 25
                + tiers.get("RED", 0) * 10
                + tiers.get("AMBER", 0) * 3
            )),
        })

    return {
        "verdict":         verdict,
        "verdict_msg":     verdict_msg,
        "total_alerts":    len(alerts_out),
        "critical_count":  critical_count,
        "high_count":      high_count,
        "alerts":          alerts_out[:20],
        "platform_health": platform_health,
    }


async def get_platform_fraud_view(session: AsyncSession, platform_id: int) -> dict:
    """Per-platform fraud view: risk table + alerts."""
    plat_result = await session.execute(
        select(Platform).where(Platform.id == platform_id)
    )
    platform = plat_result.scalar_one_or_none()
    if not platform:
        return {"error": "Platform not found"}

    scores_result = await session.execute(
        select(SkuRiskScore)
        .where(SkuRiskScore.platform_id == platform_id)
        .order_by(SkuRiskScore.z_score.desc().nullslast())
    )
    scores = scores_result.scalars().all()

    sku_table = [
        {
            "id":                    s.id,
            "sku_platform_name":     s.sku_platform_name,
            "risk_tier":             s.risk_tier,
            "z_score":               s.z_score,
            "combined_loss_rate":    s.combined_loss_rate,
            "return_rate":           s.return_rate,
            "rto_rate":              s.rto_rate,
            "cancellation_rate":     s.cancellation_rate,
            "gross_orders":          s.gross_orders,
            "returned_orders":       s.returned_orders,
            "rto_orders":            s.rto_orders,
            "pending_return_orders": s.pending_return_orders,
            "cod_abuse_flag":        s.cod_abuse_flag,
            "prepaid_return_rate":   s.prepaid_return_rate,
            "postpaid_return_rate":  s.postpaid_return_rate,
            "revenue_at_risk":       s.revenue_at_risk,
            "total_revenue":         s.total_revenue,
            "trend_direction":       s.trend_direction,
            "composite_fraud_score":    round(s.composite_fraud_score, 1) if s.composite_fraud_score is not None else None,
            "avg_return_velocity_days": s.avg_return_velocity_days,
            "velocity_fraud_count":     s.velocity_fraud_count,
            "fee_overcharge_amount":    s.fee_overcharge_amount,
        }
        for s in scores
    ]

    alerts_result = await session.execute(
        select(FraudAlert)
        .where(FraudAlert.platform_id == platform_id, FraudAlert.is_resolved == False)
        .order_by(FraudAlert.created_at.desc())
    )
    alerts = alerts_result.scalars().all()

    alerts_out = [
        {
            "id":                a.id,
            "alert_type":        a.alert_type,
            "severity":          a.severity,
            "title":             a.title,
            "body":              a.body,
            "sku_platform_name": a.sku_platform_name,
            "amount":            a.amount,
            "created_at":        a.created_at.isoformat(),
        }
        for a in alerts
    ]

    tier_counts: dict = {}
    for s in scores:
        tier_counts[s.risk_tier] = tier_counts.get(s.risk_tier, 0) + 1

    return {
        "platform_id":            platform_id,
        "platform_name":          platform.name,
        "tier_summary":           tier_counts,
        "sku_risk_table":         sku_table,
        "alerts":                 alerts_out,
        "total_alerts":           len(alerts_out),
        "cod_abuse_count":        sum(1 for s in scores if s.cod_abuse_flag),
        "total_revenue_at_risk":  sum(s.revenue_at_risk or 0 for s in scores),
    }


async def reprocess_report_for_fraud(session: AsyncSession, report_id: int) -> dict:
    """
    Reprocess an existing report for fraud intelligence.
    Deletes old order events for this report, re-extracts from file,
    recomputes risk scores and alerts.
    Used by the /fraud/backfill/{report_id} endpoint.
    """
    from app.models.pnl import PnlReport

    report_result = await session.execute(
        select(PnlReport).where(PnlReport.id == report_id)
    )
    report = report_result.scalars().first()
    if not report:
        return {"error": f"Report {report_id} not found"}

    # Try multiple file path patterns
    import os
    file_path = None
    for p in [f"uploads/pnl/{report_id}.xlsx", f"uploads/pnl/{report_id}.xls"]:
        if os.path.exists(p):
            file_path = p
            break
    if not file_path:
        return {"error": f"File not found for report {report_id}"}

    with open(file_path, "rb") as f:
        file_bytes = f.read()

    # Detect platform type from platform name
    plat_result = await session.execute(
        select(Platform).where(Platform.id == report.platform_id)
    )
    plat = plat_result.scalars().first()
    plat_name = (plat.name or "").lower() if plat else ""

    if "flipkart" in plat_name or "fk" in plat_name:
        events = extract_order_events_fk(file_bytes)
    elif "meesho" in plat_name:
        events = extract_order_events_meesho(file_bytes)
    elif "snapdeal" in plat_name:
        events = extract_order_events_snapdeal_cpr(file_bytes)
    else:
        return {"error": f"Cannot detect platform type from name: {plat_name!r}. Expected flipkart/meesho/snapdeal."}

    # Delete existing events for this report and reinsert
    await session.execute(
        delete(OrderEvent).where(OrderEvent.report_id == report_id)
    )
    await session.flush()

    count = await store_order_events(session, events, report_id, report.platform_id)
    await session.flush()

    await compute_sku_risk_scores(session, report.platform_id)
    await session.flush()
    await generate_fraud_alerts(session, report.platform_id, report_id)
    await session.commit()

    return {"reprocessed": True, "report_id": report_id, "events_extracted": count}


async def get_settlement_gaps(session: AsyncSession) -> dict:
    """Settlement reconciliation across all reports using PnlSkuRow.variance_bs."""
    from app.models.pnl import PnlSkuRow

    result = await session.execute(
        select(
            PnlReport.id,
            PnlReport.period_start,
            PnlReport.period_end,
            Platform.name.label("platform_name"),
            func.count(PnlSkuRow.id).label("sku_count"),
            func.sum(PnlSkuRow.casper_expected_bs).label("expected_total"),
            func.sum(PnlSkuRow.bank_settlement_projected).label("actual_total"),
            func.sum(PnlSkuRow.variance_bs).label("total_gap"),
        )
        .join(PnlSkuRow, PnlSkuRow.report_id == PnlReport.id)
        .join(Platform, PnlReport.platform_id == Platform.id)
        .where(
            PnlSkuRow.variance_bs.isnot(None),
            PnlSkuRow.casper_expected_bs.isnot(None),
        )
        .group_by(PnlReport.id, PnlReport.period_start, PnlReport.period_end, Platform.name)
        .order_by(PnlReport.period_start.desc())
    )
    rows = result.all()

    reports = []
    for row in rows:
        gap      = float(row.total_gap or 0)
        expected = float(row.expected_total or 0)
        pct_gap  = gap / abs(expected) if expected != 0 else 0
        severity = _settlement_gap_severity(gap, pct_gap) if gap < 0 else None

        reports.append({
            "report_id":     row[0],
            "period":        f"{row[1]} → {row[2]}",
            "platform_name": row[3],
            "sku_count":     row[4],
            "expected_bs":   round(expected, 2),
            "actual_bs":     round(float(row.actual_total or 0), 2),
            "gap":           round(gap, 2),
            "pct_gap":       round(pct_gap, 4),
            "severity":      severity,
        })

    total_gap = sum(r["gap"] for r in reports)
    return {
        "reports":   reports,
        "total_gap": round(total_gap, 2),
        "gap_count": sum(1 for r in reports if r["gap"] < -100),
        "note":      "Gap = actual settlement − Casper target. Negative = platform paid less than expected.",
    }


# ── Dashboard aggregates ──────────────────────────────────────────────────────

async def get_fraud_dashboard(session: AsyncSession) -> dict:
    """Aggregated risk view across all platforms."""
    # Risk tier distribution
    tier_result = await session.execute(
        select(SkuRiskScore.risk_tier, func.count(SkuRiskScore.id))
        .group_by(SkuRiskScore.risk_tier)
    )
    tier_counts = {row[0]: row[1] for row in tier_result}

    # Total revenue at risk
    rev_result = await session.execute(
        select(func.sum(SkuRiskScore.revenue_at_risk))
    )
    total_rev_at_risk = float(rev_result.scalar() or 0)

    # Pending returns count
    pending_result = await session.execute(
        select(func.sum(SkuRiskScore.pending_return_orders))
    )
    total_pending = int(pending_result.scalar() or 0)

    # COD abuse count
    cod_result = await session.execute(
        select(func.count(SkuRiskScore.id))
        .where(SkuRiskScore.cod_abuse_flag == True)
    )
    cod_abuse_count = int(cod_result.scalar() or 0)

    # All risk scores for table
    scores_result = await session.execute(
        select(SkuRiskScore, Platform.name.label("platform_name"))
        .join(Platform, SkuRiskScore.platform_id == Platform.id)
        .order_by(SkuRiskScore.z_score.desc().nullslast(), SkuRiskScore.combined_loss_rate.desc().nullslast())
    )
    scores_rows = scores_result.all()
    sku_table = [
        {
            "id":                  s.id,
            "sku_platform_name":   s.sku_platform_name,
            "platform_name":       pname,
            "risk_tier":           s.risk_tier,
            "z_score":             s.z_score,
            "combined_loss_rate":  s.combined_loss_rate,
            "return_rate":         s.return_rate,
            "rto_rate":            s.rto_rate,
            "cancellation_rate":   s.cancellation_rate,
            "gross_orders":        s.gross_orders,
            "returned_orders":     s.returned_orders,
            "rto_orders":          s.rto_orders,
            "pending_return_orders": s.pending_return_orders,
            "cod_abuse_flag":      s.cod_abuse_flag,
            "prepaid_return_rate": s.prepaid_return_rate,
            "postpaid_return_rate": s.postpaid_return_rate,
            "revenue_at_risk":     s.revenue_at_risk,
            "total_revenue":       s.total_revenue,
            "avg_sale_amount":     s.avg_sale_amount,
            "trend_direction":     s.trend_direction,
            "platform_avg_return_rate": s.platform_avg_return_rate,
            "composite_fraud_score":    round(s.composite_fraud_score, 1) if s.composite_fraud_score is not None else None,
            "avg_return_velocity_days": s.avg_return_velocity_days,
            "velocity_fraud_count":     s.velocity_fraud_count,
            "fee_overcharge_amount":    s.fee_overcharge_amount,
        }
        for s, pname in scores_rows
    ]

    # Temporal: weekly return rate (all platforms combined)
    week_result = await session.execute(
        text("""
            SELECT
                strftime('%Y-W%W', order_date) AS week,
                COUNT(CASE WHEN order_status IN ('RETURNED','RTO','PENDING_RETURN') THEN 1 END) AS losses,
                COUNT(CASE WHEN order_status NOT IN ('CANCELLED','IN_TRANSIT') THEN 1 END) AS shipped,
                COUNT(*) AS total
            FROM order_events
            WHERE order_date IS NOT NULL
            GROUP BY week
            ORDER BY week
        """)
    )
    weekly_data = [
        {
            "week":        row[0],
            "losses":      row[1],
            "shipped":     row[2],
            "total":       row[3],
            "loss_rate":   round(row[1] / row[2], 4) if row[2] > 0 else 0.0,
        }
        for row in week_result
    ]

    # Cross-platform comparison: same sku_pricing_id across multiple platforms
    cross_result = await session.execute(
        select(
            SkuRiskScore.sku_pricing_id,
            SkuRiskScore.sku_platform_name,
            Platform.name.label("platform_name"),
            SkuRiskScore.combined_loss_rate,
            SkuRiskScore.risk_tier,
            SkuRiskScore.gross_orders,
        )
        .join(Platform, SkuRiskScore.platform_id == Platform.id)
        .where(SkuRiskScore.sku_pricing_id.isnot(None))
        .order_by(SkuRiskScore.sku_pricing_id, SkuRiskScore.combined_loss_rate.desc().nullslast())
    )
    cross_rows = cross_result.all()

    # Group by sku_pricing_id
    from collections import defaultdict
    cross_map: dict = defaultdict(list)
    for row in cross_rows:
        cross_map[row.sku_pricing_id].append({
            "platform_name":      row.platform_name,
            "sku_platform_name":  row.sku_platform_name,
            "combined_loss_rate": row.combined_loss_rate,
            "risk_tier":          row.risk_tier,
            "gross_orders":       row.gross_orders,
        })
    # Only include SKUs present on 2+ platforms
    cross_platform = [
        {"sku_pricing_id": k, "platforms": v}
        for k, v in cross_map.items()
        if len(v) >= 2
    ]

    return {
        "tier_summary": {
            "CRITICAL": tier_counts.get("CRITICAL", 0),
            "RED":       tier_counts.get("RED", 0),
            "AMBER":     tier_counts.get("AMBER", 0),
            "GREEN":     tier_counts.get("GREEN", 0),
        },
        "total_revenue_at_risk": total_rev_at_risk,
        "total_pending_returns": total_pending,
        "cod_abuse_skus":        cod_abuse_count,
        "sku_risk_table":        sku_table,
        "weekly_loss_trend":     weekly_data,
        "cross_platform":        cross_platform,
    }
