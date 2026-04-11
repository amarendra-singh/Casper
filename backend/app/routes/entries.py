from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_any
from app.schemas.entries import UpsertBatchRequest, UpsertBatchResponse, EntryRowResponse
from app.services.entries import upsert_batch, get_all_entries


router = APIRouter(prefix="/entries", tags=["Entries"])


@router.post("/upsert-batch", response_model=UpsertBatchResponse)
async def upsert_entries_batch(
    request: UpsertBatchRequest,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_any),
):
    saved, errors = await upsert_batch(db, request.rows)

    return UpsertBatchResponse(
        saved       = saved,
        errors      = errors,
        total       = len(request.rows),
        saved_count = len(saved),
        error_count = len(errors),
    )


@router.get("/", response_model=list[EntryRowResponse])
async def get_entries(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_any),
):
    return await get_all_entries(db)
