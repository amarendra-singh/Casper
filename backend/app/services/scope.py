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
