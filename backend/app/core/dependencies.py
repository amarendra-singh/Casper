"""
CasperV2 — Reusable FastAPI dependencies (auth guards)
"""

from typing import Optional

from fastapi import Depends, HTTPException, status, Header
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

async def get_active_company(
    x_company_id: int = Header(..., alias="X-Company-Id"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services.company import get_membership
    row = await get_membership(db, current_user.id, x_company_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this company")
    company, _role = row
    return company


def require_company_role(*roles):
    """Factory — dependency that enforces the caller's role within the active company."""
    async def guard(
        x_company_id: int = Header(..., alias="X-Company-Id"),
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
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