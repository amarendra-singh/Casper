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
async def test_role_is_checked_in_the_records_own_company(monkeypatch):
    """
    Editing from master mode must be judged by the caller's role in the company
    that owns the record — not a global role, and not the company they are viewing.
    """
    from app.core import dependencies as deps
    from app.models.company import CompanyRole

    async def membership(db, user_id, company_id):
        # owner of company 1, viewer of company 2, not a member of company 3
        return {1: (object(), CompanyRole.owner),
                2: (object(), CompanyRole.viewer)}.get(company_id)

    import app.services.company as company_svc
    monkeypatch.setattr(company_svc, "get_membership", membership)

    user = SimpleNamespace(id=1)

    # owner in company 1 → allowed
    await deps.require_role_in_company(None, user, 1)

    # only a viewer in company 2 → refused, even though they own company 1
    with pytest.raises(HTTPException) as exc:
        await deps.require_role_in_company(None, user, 2)
    assert exc.value.status_code == 403
    assert "viewer" in exc.value.detail

    # not a member of company 3 → 404, so the record's existence is not confirmed
    with pytest.raises(HTTPException) as exc:
        await deps.require_role_in_company(None, user, 3)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_viewer_can_be_allowed_explicitly(monkeypatch):
    from app.core import dependencies as deps
    from app.models.company import CompanyRole
    import app.services.company as company_svc

    async def membership(db, user_id, company_id):
        return (object(), CompanyRole.viewer)
    monkeypatch.setattr(company_svc, "get_membership", membership)

    # default set excludes viewer …
    with pytest.raises(HTTPException):
        await deps.require_role_in_company(None, SimpleNamespace(id=1), 1)
    # … but callers can widen it
    await deps.require_role_in_company(None, SimpleNamespace(id=1), 1,
                                       CompanyRole.viewer, CompanyRole.admin, CompanyRole.owner)


def test_write_services_stay_single_company():
    """
    Consolidation must cover READS only. The fraud compute_* functions delete then
    re-insert a company's rows — running them over several companies would wipe
    one company's profiles while rebuilding another's.
    """
    import inspect
    from app.services import fraud

    for name in ("compute_actor_risk_profiles", "compute_state_risk_profiles",
                 "compute_return_reason_clusters", "compute_sku_risk_scores",
                 "generate_fraud_alerts"):
        sig = inspect.signature(getattr(fraud, name))
        annotation = str(sig.parameters["company_id"].annotation)
        assert "list" not in annotation, f"{name} must stay single-company, got {annotation}"


def test_read_services_accept_many_companies():
    import inspect
    from app.services import fraud, ledger, billing, entries, profitability

    for mod, name in ((fraud, "get_fraud_overview"), (fraud, "get_actor_overview"),
                      (ledger, "compute_ledger_summary"), (billing, "compute_billing_summary"),
                      (entries, "get_all_entries"), (profitability, "compute_sku_intelligence")):
        sig = inspect.signature(getattr(mod, name))
        annotation = str(sig.parameters["company_id"].annotation)
        assert "list" in annotation, f"{name} should accept a company list, got {annotation}"


@pytest.mark.asyncio
async def test_group_mode_rejects_garbage_company_header():
    with pytest.raises(HTTPException) as exc:
        await get_active_company(_Req("GET"), "not-a-number", SimpleNamespace(id=1), None)
    assert exc.value.status_code == 400
