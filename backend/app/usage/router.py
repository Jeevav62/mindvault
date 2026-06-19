"""GET /usage — provider stats snapshot for the current server process."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth.dependencies import get_current_user
from app.providers import stats

router = APIRouter(prefix="/usage", tags=["usage"])


@router.get("")
async def get_usage(_=Depends(get_current_user)) -> dict:
    return {"usage": stats.snapshot()}
