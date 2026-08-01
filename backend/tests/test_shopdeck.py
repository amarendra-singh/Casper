"""Unit tests for the ShopDeck report parser (styles-independent OOXML)."""
import pytest
from app.services.shopdeck import (
    _parse_order_report, _parse_reconciliation, _detect_kind,
    extract_period_shopdeck, read_shopdeck_xlsx, is_shopdeck, parse_shopdeck,
)

# ── Synthetic "sheets" mimicking read_shopdeck_xlsx output ──────────────────────

ORDER_REPORT_HDR = [
    "Date", "Total Revenue (in Rs.)", "Average Order Value", "Cancellation Revenue",
    "Intransit Revenue", "RTO Revenue", "RTO/Cancellation Charge", "Delivered Revenue",
    "Return Revenue", "Shipping Charge", "Marketing Spend", "Shopdeck Service Fees",
    "PG Commision", "Net Remittance", "Remitted Amount", "Remittance Pending",
]


def _order_report_sheets():
    # two days of real activity
    r1 = ["01-May", "1000", "500", "0", "0", "0", "0", "800", "100", "50", "30", "40", "20", "660", "600", "60"]
    r2 = ["02-May", "2000", "500", "0", "0", "0", "0", "1600", "0", "100", "70", "80", "40", "1310", "1310", "0"]
    return {"Revenue": [["Order Report (Revenue)"], ["Date Range: 01/05/2026"], ORDER_REPORT_HDR, r1, r2]}


def test_order_report_aggregates():
    s = _parse_order_report(_order_report_sheets())
    assert s["gross_sales"] == 3000.0          # 1000 + 2000
    assert s["returns_amount"] == 100.0
    assert s["net_sales"] == 2400.0            # delivered 800 + 1600
    assert s["net_earnings"] == 1970.0         # net remittance 660 + 1310
    assert s["amount_settled"] == 1910.0       # 600 + 1310
    assert s["amount_pending"] == 60.0
    assert s["marketing_fee"] == 100.0         # 30 + 70
    assert s["commission_total"] == 60.0       # 20 + 40
    # fees = shipping(150) + marketing(100) + service(120) + pg(60) = 430
    assert s["total_expenses"] == 430.0
    assert s["net_margin_pct"] == round(1970 / 3000 * 100, 2)


# ── Reconciliation ──────────────────────────────────────────────────────────────

RECON_HDR = [
    "Order ID", "Order Status", "Product Code", "SKU Code", "Quantity",
    "Product Value Taxable", "Shopdeck Service Fees", "Invoice Total",
    "COD Payable Amount",
]


def _recon_sheets(rows):
    return {"Reconciliation": [["Order Reconciliation Report"], ["Date Range: 01/05/2026"], RECON_HDR] + rows}


def test_reconciliation_delivered_order():
    rows = [["O1", "Delivered", "SKU-A", "SKU-A", "2", "1000", "100", "1100", "950"]]
    summary, sku = _parse_reconciliation(_recon_sheets(rows))
    assert len(sku) == 1
    r = sku[0]
    assert r["platform_sku_name"] == "SKU-A"
    assert r["gross_units"] == 2
    assert r["net_units"] == 2
    assert r["rto_units"] == 0
    assert r["bank_settlement_projected"] == 950.0   # COD payable wins
    assert r["earnings_per_unit"] == 475.0
    assert summary["gross_sales"] == 1000.0


def test_reconciliation_rto_zeroes_net_units():
    rows = [["O2", "RTO Delivered", "SKU-B", "SKU-B", "3", "900", "60", "960", ""]]
    summary, sku = _parse_reconciliation(_recon_sheets(rows))
    r = sku[0]
    assert r["rto_units"] == 3
    assert r["net_units"] == 0
    assert summary["returned_units"] == 3
    # no COD payable → invoice - fee = 960 - 60 = 900
    assert r["bank_settlement_projected"] == 900.0


def test_reconciliation_return_flag():
    rows = [["O3", "Return Delivered", "SKU-C", "SKU-C", "1", "500", "40", "540", ""]]
    _, sku = _parse_reconciliation(_recon_sheets(rows))
    assert sku[0]["rvp_units"] == 1
    assert sku[0]["net_units"] == 0


def test_reconciliation_skips_blank_sku():
    rows = [["O4", "Delivered", "", "", "1", "100", "10", "110", "90"]]
    _, sku = _parse_reconciliation(_recon_sheets(rows))
    assert sku == []


# ── Detection + period ──────────────────────────────────────────────────────────

def test_detect_kind():
    assert _detect_kind(_order_report_sheets()) == "order_report"
    assert _detect_kind(_recon_sheets([])) == "reconciliation"
    assert _detect_kind({"X": [["random"]]}) == "unknown"


def test_empty_order_report():
    # all-zero day still produces a summary with zero values (graceful)
    sheets = {"Revenue": [["Order Report (Revenue)"], ["Date Range: 01/05/2026"], ORDER_REPORT_HDR,
                          ["01-May"] + ["0"] * 15]}
    s = _parse_order_report(sheets)
    assert s["gross_sales"] == 0.0
    assert s["net_margin_pct"] is None       # no gross → None, not divide-by-zero


# ── Real sample files (zero-data, proves reader + detection end-to-end) ──────────

import os
_D = r"C:\Users\MSI-PC\Downloads"
_HAS_SAMPLES = os.path.isdir(_D) and os.path.exists(
    os.path.join(_D, "Order_Report_Lo9COYW9zP.xlsx"))


@pytest.mark.skipif(not _HAS_SAMPLES, reason="sample files not present")
def test_real_order_report_file():
    b = open(os.path.join(_D, "Order_Report_Lo9COYW9zP.xlsx"), "rb").read()
    assert is_shopdeck(b) is True
    start, end = extract_period_shopdeck(b)
    assert start.month == 5 and start.year == 2026
    summary, rows = parse_shopdeck(b)
    assert "gross_sales" in summary          # mapped, even if 0.0


@pytest.mark.skipif(not _HAS_SAMPLES, reason="sample files not present")
def test_unrelated_file_not_shopdeck():
    p = os.path.join(_D, "durgapur_land_phase1_analysis.xlsx")
    if os.path.exists(p):
        assert is_shopdeck(open(p, "rb").read()) is False


@pytest.mark.skipif(not _HAS_SAMPLES, reason="sample files not present")
def test_real_product_performance():
    from app.services.shopdeck import parse_product_performance
    p = os.path.join(_D, "Product_Performance_Report_WbyAmRsIEv.xlsx")
    if os.path.exists(p):
        prods = parse_product_performance(open(p, "rb").read())
        assert len(prods) > 0                       # 172 products in sample
        assert "sku" in prods[0] and "rto_pct" in prods[0]


@pytest.mark.skipif(not _HAS_SAMPLES, reason="sample files not present")
def test_real_shipping_performance():
    from app.services.shopdeck import parse_shipping_performance
    p = os.path.join(_D, "Shipping_Performance_Report_6a1b734c721a592995650668.xlsx")
    if os.path.exists(p):
        f = parse_shipping_performance(open(p, "rb").read())
        assert "total_orders" in f and "rto_pct" in f


# ── Cashflow PDF (pure text walk + real file) ───────────────────────────────────

def test_cashflow_text_parse():
    from app.services.shopdeck import _parse_cashflow_text
    from datetime import date
    text = (
        "Cashflow\tReport:\t01/05/2026\t-\t31/05/2026\n"
        "Shipping\tCharge\n120.00\n"
        "Marketing\tSpend\n300.00\n"
        "Shopdeck\tService\tFees\n80.00\n"
        "Returned\tOrders\tAmount\n45.00\n"
        "Net\tReceived\n1455.00\n"
    )
    out = _parse_cashflow_text(text)
    assert out["period"] == (date(2026, 5, 1), date(2026, 5, 31))
    assert out["shipping_charge"] == 120.0
    assert out["marketing_spend"] == 300.0
    assert out["service_fees"] == 80.0
    assert out["returned_amount"] == 45.0
    assert out["net_received"] == 1455.0


def test_cashflow_text_empty():
    from app.services.shopdeck import _parse_cashflow_text
    out = _parse_cashflow_text("Cashflow Report: 01/05/2026 - 31/05/2026\nNet Received\n0.00\n")
    assert out["net_received"] == 0.0
    assert out["marketing_spend"] is None        # absent → None, no crash


@pytest.mark.skipif(not _HAS_SAMPLES, reason="sample files not present")
def test_real_cashflow_pdf():
    from app.services.shopdeck import parse_cashflow_pdf
    p = os.path.join(_D, "Cashflow_Report_Eb3yADAIGJ.pdf")
    if os.path.exists(p):
        out = parse_cashflow_pdf(open(p, "rb").read())
        assert out["period"] is not None
        assert "net_received" in out
