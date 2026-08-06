"""
Company scoping for consolidated (group) mode.

These guard the two properties that matter: consolidated reads cover exactly the
user's companies, and group mode can never write — a record must belong to one
entity, since GST and the frozen cost basis are per company.
"""
import pytest
from types import SimpleNamespace

from fastapi import HTTPException

from app.core.dependencies import CompanyScope, get_active_company, ALL_COMPANIES
from app.services.scope import company_ids


# ── the int-or-list helper every scoped service now goes through ──────────────

def test_company_ids_accepts_single_and_list():
    assert company_ids(5) == [5]
    assert company_ids([1, 2, 3]) == [1, 2, 3]
    assert company_ids((4, 5)) == [4, 5]


def test_company_ids_normalises_to_int():
    assert company_ids("7") == [7]


# ── CompanyScope ─────────────────────────────────────────────────────────────

def _co(i, name):
    return SimpleNamespace(id=i, name=name)


def test_scope_single_company():
    s = CompanyScope([_co(1, "Shringar")], is_all=False)
    assert s.ids == [1] and s.is_all is False
    assert s.label == "Shringar"
    assert s.primary.id == 1


def test_scope_all_companies():
    s = CompanyScope([_co(1, "A"), _co(2, "B"), _co(3, "C")], is_all=True)
    assert s.ids == [1, 2, 3]
    assert s.label == "All companies"


def test_scope_empty_is_safe():
    s = CompanyScope([], is_all=False)
    assert s.ids == [] and s.primary is None and s.label == ""


# ── group mode must never write ──────────────────────────────────────────────

class _Req:
    def __init__(self, method): self.method = method


@pytest.mark.asyncio
async def test_group_mode_refuses_writes():
    """A write in 'all' mode has no unambiguous target company — refuse, don't guess."""
    for method in ("POST", "PATCH", "PUT", "DELETE"):
        with pytest.raises(HTTPException) as exc:
            await get_active_company(_Req(method), ALL_COMPANIES,
                                     SimpleNamespace(id=1), None)
        assert exc.value.status_code == 400
        assert "specific company" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_group_mode_rejects_garbage_company_header():
    with pytest.raises(HTTPException) as exc:
        await get_active_company(_Req("GET"), "not-a-number", SimpleNamespace(id=1), None)
    assert exc.value.status_code == 400
