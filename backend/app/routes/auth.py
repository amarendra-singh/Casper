"""
CasperV2 — Auth routes: login, refresh, me, change password
"""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from app.core.database import get_db
from app.core.security import verify_password, create_access_token, create_refresh_token, decode_token, hash_password
from app.core.dependencies import get_current_user
from app.models.user import User, UserRole
from app.schemas.auth import LoginRequest, TokenResponse, RefreshRequest, ChangePasswordRequest
from app.schemas.user import UserResponse
from app.schemas.company import RegisterRequest
from app.services.company import create_company, list_user_companies


def _companies_payload(rows) -> list[dict]:
    """[(Company, role)] → list of dicts for the auth response."""
    return [
        {"id": c.id, "name": c.name, "slug": c.slug, "color": c.color, "role": r.value}
        for c, r in rows
    ]

router = APIRouter(prefix="/auth", tags=["Auth"])

# ── Simple in-memory rate limiter (5 attempts/min per IP) ─────────────────────
_login_attempts: dict[str, list] = defaultdict(list)
_RATE_WINDOW = timedelta(minutes=1)
_RATE_LIMIT   = 5


def _check_rate_limit(ip: str) -> None:
    now = datetime.now(tz=timezone.utc)
    cutoff = now - _RATE_WINDOW
    _login_attempts[ip] = [t for t in _login_attempts[ip] if t > cutoff]
    if len(_login_attempts[ip]) >= _RATE_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Wait 1 minute and try again.",
        )
    _login_attempts[ip].append(now)


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    _check_rate_limit(request.client.host or "unknown")
    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()

    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is inactive",
        )

    token_data = {"sub": str(user.id)}
    companies = _companies_payload(await list_user_companies(db, user.id))

    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
        role=user.role.value,
        name=user.name,
        companies=companies,
    )


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """Self-service signup: creates the user + their first company (owner)."""
    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    user = User(
        name=payload.name.strip(),
        email=payload.email,
        password_hash=hash_password(payload.password),
        role=UserRole.admin,          # platform-level role; company role lives on membership
        is_active=True,
    )
    db.add(user)
    await db.flush()
    await create_company(db, user.id, payload.company_name)
    await db.commit()

    token_data = {"sub": str(user.id)}
    companies = _companies_payload(await list_user_companies(db, user.id))
    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
        role=user.role.value,
        name=user.name,
        companies=companies,
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(payload: RefreshRequest, db: AsyncSession = Depends(get_db)):
    decoded = decode_token(payload.refresh_token)

    if not decoded or decoded.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    result = await db.execute(select(User).where(User.id == int(decoded["sub"])))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    token_data = {"sub": str(user.id)}

    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
        role=user.role.value,
        name=user.name,
    )


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/change-password")
async def change_password(
    payload: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")

    current_user.password_hash = hash_password(payload.new_password)
    db.add(current_user)
    await db.commit()

    return {"message": "Password changed successfully"}


@router.post("/logout")
async def logout(current_user: User = Depends(get_current_user)):
    """
    Server-side logout acknowledgement.
    Token revocation is client-side (remove from localStorage).
    Future: invalidate via jti blacklist.
    """
    return {"message": "Logged out successfully"}