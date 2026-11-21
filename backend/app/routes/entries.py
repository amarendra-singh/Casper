from app.core.dependencies import require_company_role
from app.models.company import CompanyRole
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_any, get_active_company, get_company_scope
from app.schemas.entries import UpsertBatchRequest, UpsertBatchResponse, EntryRowResponse
from app.services.entries import upsert_batch, get_all_entries


router = APIRouter(prefix="/entries", tags=["Entries"])


@router.post("/upsert-batch", response_model=UpsertBatchResponse)
async def upsert_entries_batch(
    request: UpsertBatchRequest,
    db: AsyncSession = Depends(get_db),
    company=Depends(require_company_role(CompanyRole.owner, CompanyRole.admin)),
    _=Depends(require_any),
):
    saved, errors = await upsert_batch(db, request.rows, company.id)

    return UpsertBatchResponse(
        saved       = saved,
        errors      = errors,
        total       = len(request.rows),
        saved_count = len(saved),
        error_count = len(errors),
    )


@router.get("/", response_model=list[EntryRowResponse])
async def get_entries(
    include_inactive: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    scope=Depends(get_company_scope),
    _=Depends(require_any),
):
    return await get_all_entries(db, scope.ids, include_inactive=include_inactive)
