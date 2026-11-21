"""
Company scoping helper for consolidated (group-mode) reads.

Dashboard and P&L services historically took a single `company_id: int`. Group
mode needs the same maths over several companies, so they now accept either an
int or a list of ints and normalise through `company_ids()`.

Accepting both keeps every existing call site — and its tests — working
unchanged, which matters: these filters are what enforce tenant isolation, so
the fewer of them that get rewritten, the smaller the chance of a data leak.
"""
from __future__ import annotations


def company_ids(company_id: int | list[int] | tuple | set) -> list[int]:
    """Normalise a single company id or a collection of them into a list."""
    if isinstance(company_id, (list, tuple, set)):
        return [int(c) for c in company_id]
    return [int(company_id)]


def unambiguous_report_ids(company_id):
    """Exclude ambiguous overlapping coverage rather than double-count money.

    No arbitrary winning report is selected. Original reports remain readable;
    the dashboard discloses exclusions so operators can resolve their coverage.
    """
    from sqlalchemy import select, exists
    from sqlalchemy.orm import aliased
    from app.models.pnl import PnlReport
    other = aliased(PnlReport)
    overlap = exists(select(other.id).where(
        other.id != PnlReport.id,
        other.company_id == PnlReport.company_id,
        other.platform_id == PnlReport.platform_id,
        other.period_start <= PnlReport.period_end,
        other.period_end >= PnlReport.period_start,
    ))
    return select(PnlReport.id).where(
        PnlReport.company_id.in_(company_ids(company_id)), ~overlap,
    )
