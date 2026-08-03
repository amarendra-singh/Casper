"""
Contract tests: every router must actually be mounted on the app.

Regression guard for the class of bug where a route module exists and its
handler functions are unit-tested, but the router is never registered in
main.py — so the endpoint 404s in production while unit tests stay green.
"""
from app.main import app


def _paths() -> set[str]:
    return {getattr(r, "path", None) for r in app.routes}


def test_dashboard_router_mounted():
    """Dashboard ribbon + insight endpoints must be reachable (guards B0)."""
    paths = _paths()
    assert "/api/v1/dashboard/metrics" in paths
    assert "/api/v1/dashboard/insights" in paths


def test_core_routers_mounted():
    """Spot-check that the main feature routers are all registered."""
    paths = _paths()
    for expected in [
        "/api/v1/auth/login",
        "/api/v1/skus/",
        "/api/v1/pnl/upload",
        "/api/v1/pnl/shopdeck-customers",
        "/api/v1/pnl/statement/{report_id}",
        "/api/v1/pnl/trend",
        "/api/v1/pnl/consolidated",
        "/api/v1/fraud/actors",
        "/api/v1/dashboard/metrics",
    ]:
        assert expected in paths, f"route not mounted: {expected}"
