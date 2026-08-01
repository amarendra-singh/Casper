"""Unit tests for the billing summary pure function."""
from datetime import date, timedelta
from app.services.billing import build_billing_summary, derive_status

TODAY = date(2026, 7, 28)


def _inv(status, total, paid, due_offset=None):
    due = TODAY + timedelta(days=due_offset) if due_offset is not None else None
    return {"status": status, "total": total, "amount_paid": paid, "due_date": due}


def test_empty():
    out = build_billing_summary([], TODAY)
    assert out["total_invoiced"] == 0 and out["outstanding"] == 0 and out["count"] == 0
    assert out["aging"] == {"0-30": 0, "31-60": 0, "60+": 0}


def test_derive_status_overdue():
    assert derive_status("sent", date(2026, 7, 1), TODAY) == "overdue"
    assert derive_status("sent", date(2026, 8, 1), TODAY) == "sent"
    assert derive_status("paid", date(2026, 1, 1), TODAY) == "paid"   # paid never overdue
    assert derive_status("cancelled", date(2026, 1, 1), TODAY) == "cancelled"


def test_totals_and_outstanding():
    rows = [
        _inv("paid", 1000, 1000, due_offset=-5),      # fully paid
        _inv("sent", 2000, 500, due_offset=10),       # partly paid, not due yet
    ]
    out = build_billing_summary(rows, TODAY)
    assert out["total_invoiced"] == 3000
    assert out["total_paid"] == 1500
    assert out["outstanding"] == 1500     # 2000-500 (the paid one is settled)
    assert out["overdue"] == 0            # nothing past due
    assert out["count"] == 2


def test_cancelled_excluded_from_totals():
    rows = [_inv("cancelled", 5000, 0), _inv("sent", 1000, 0, due_offset=30)]
    out = build_billing_summary(rows, TODAY)
    assert out["total_invoiced"] == 1000   # cancelled not counted
    assert out["count"] == 1
    statuses = {b["status"] for b in out["by_status"]}
    assert "cancelled" in statuses


def test_aging_buckets():
    rows = [
        _inv("sent", 100, 0, due_offset=-10),   # 10 days overdue → 0-30
        _inv("sent", 200, 0, due_offset=-45),   # 45 → 31-60
        _inv("sent", 300, 0, due_offset=-90),   # 90 → 60+
    ]
    out = build_billing_summary(rows, TODAY)
    assert out["aging"] == {"0-30": 100.0, "31-60": 200.0, "60+": 300.0}
    assert out["overdue"] == 600.0
