"""Unit tests for the ledger summary pure function."""
from app.services.ledger import build_ledger_summary


def _r(direction, category, amount):
    return {"direction": direction, "category": category, "amount": amount}


def test_empty():
    out = build_ledger_summary([])
    assert out == {"total_income": 0, "total_expense": 0, "net": 0, "count": 0, "by_category": []}


def test_income_expense_net():
    rows = [
        _r("income", "settlement", 1000.0),
        _r("expense", "inventory", 400.0),
        _r("expense", "ads", 100.0),
    ]
    out = build_ledger_summary(rows)
    assert out["total_income"] == 1000.0
    assert out["total_expense"] == 500.0
    assert out["net"] == 500.0
    assert out["count"] == 3


def test_by_category_grouping_and_sort():
    rows = [
        _r("expense", "inventory", 300.0),
        _r("expense", "inventory", 200.0),   # same bucket → 500 total, count 2
        _r("expense", "ads", 150.0),
    ]
    out = build_ledger_summary(rows)
    # sorted by total desc → inventory first
    assert out["by_category"][0] == {"category": "inventory", "direction": "expense", "total": 500.0, "count": 2}
    assert out["by_category"][1] == {"category": "ads", "direction": "expense", "total": 150.0, "count": 1}


def test_same_category_different_direction_are_separate_buckets():
    rows = [_r("income", "refund", 100.0), _r("expense", "refund", 40.0)]
    out = build_ledger_summary(rows)
    cats = {(b["category"], b["direction"]): b["total"] for b in out["by_category"]}
    assert cats[("refund", "income")] == 100.0
    assert cats[("refund", "expense")] == 40.0


def test_rounding():
    out = build_ledger_summary([_r("expense", "misc", 10.005), _r("expense", "misc", 0.005)])
    assert out["total_expense"] == 10.01
