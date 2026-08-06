"""
CasperV2 — Reusable FastAPI dependencies (auth guards)
"""

from typing import Optional

from fastapi import Depends, HTTPException, status, Header, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import decode_token
from app.models.user import User, UserRole

# auto_error=False so a MISSING Authorization header yields None (→ our own 401)
# instead of HTTPBearer's default 403, which is the wrong status for "unauthenticated".
bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    token = credentials.credentials
    payload = decode_token(token)

    if not payload or payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    user_id = payload.get("sub")
    try:
        user_id_int = int(user_id)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
    result = await db.execute(select(User).where(User.id == user_id_int))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    return user


def require_roles(*roles: UserRole):
    """Factory — returns a dependency that enforces allowed roles."""
    async def role_guard(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required roles: {[r.value for r in roles]}",
            )
        return current_user
    return role_guard


# ── Shorthand guards ──────────────────────────────────────
require_super_admin = require_roles(UserRole.super_admin)
require_admin_or_above = require_roles(UserRole.super_admin, UserRole.admin)
require_any = require_roles(UserRole.super_admin, UserRole.admin, UserRole.viewer)


# ── Company-scoped guards (multi-tenancy) ──────────────────────────
# The frontend sends the active company via the X-Company-Id header; these
# verify the caller's membership and return the Company for query scoping.

ALL_COMPANIES = "all"


async def _user_companies(db, user_id: int):
    from app.services.company import list_user_companies
    return [c for c, _role in await list_user_companies(db, user_id)]


async def get_active_company(
    request: Request = None,
    x_company_id: str = Header(..., alias="X-Company-Id"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Resolve the single company a request is scoped to.

    In group mode the frontend sends `X-Company-Id: all`:
      * GET  — fall back to the user's first company so routes that are not yet
               consolidation-aware still render instead of 422-ing. Consolidated
               endpoints use `get_company_scope` and ignore this fallback.
      * write — REFUSED. A record must belong to exactly one entity (GST and the
               frozen cost basis are per company), and silently writing into
               whichever company happened to be first would be a data-integrity
               bug, not a convenience.
    """
    from app.services.company import get_membership

    if str(x_company_id).strip().lower() == ALL_COMPANIES:
        method = getattr(request, "method", "GET") if request is not None else "GET"
        if method not in ("GET", "HEAD", "OPTIONS"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Select a specific company before making changes.",
            )
        companies = await _user_companies(db, current_user.id)
        if not companies:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No companies")
        return companies[0]

    try:
        company_id = int(x_company_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid X-Company-Id")

    row = await get_membership(db, current_user.id, company_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this company")
    company, _role = row
    return company


class CompanyScope:
    """
    What a consolidated read covers: one company, or all of the user's.

    Group mode fans the existing per-company computation out over `companies` and
    aggregates, rather than rewriting ~109 `company_id ==` filters to `IN (...)`.
    That keeps tenant isolation — the one bug class this code cannot afford —
    provably unchanged, and yields the per-company breakdown the view needs anyway.
    """
    def __init__(self, companies: list, is_all: bool):
        self.companies = companies
        self.is_all = is_all

    @property
    def ids(self) -> list[int]:
        return [c.id for c in self.companies]

    @property
    def primary(self):
        return self.companies[0] if self.companies else None

    @property
    def label(self) -> str:
        return "All companies" if self.is_all else (self.primary.name if self.primary else "")


async def get_company_scope(
    x_company_id: str = Header(..., alias="X-Company-Id"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CompanyScope:
    """Read-side scope: `all` → every company the user belongs to; else just that one."""
    if str(x_company_id).strip().lower() == ALL_COMPANIES:
        companies = await _user_companies(db, current_user.id)
        if not companies:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No companies")
        return CompanyScope(companies, is_all=True)

    company = await get_active_company(None, x_company_id, current_user, db)
    return CompanyScope([company], is_all=False)


def require_company_role(*roles):
    """Factory — dependency that enforces the caller's role within the active company."""
    async def guard(
        x_company_id: str = Header(..., alias="X-Company-Id"),
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        # Role is per company, so group mode has no single role to check.
        if str(x_company_id).strip().lower() == ALL_COMPANIES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail="Select a specific company before making changes.")
        try:
            x_company_id = int(x_company_id)
        except (TypeError, ValueError):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid X-Company-Id")
        from app.services.company import get_membership
        row = await get_membership(db, current_user.id, x_company_id)
        if not row:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this company")
        company, role = row
        if role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail=f"Requires company role: {[r.value for r in roles]}")
        return company
    return guard