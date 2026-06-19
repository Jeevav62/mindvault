from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.auth.repository import UserRecord

from . import service

router = APIRouter(prefix="/memory", tags=["memory"])


class MemoryItem(BaseModel):
    id: str
    memory: str


class MemoryListResponse(BaseModel):
    items: list[MemoryItem]


@router.get("", response_model=MemoryListResponse)
async def list_memories(user: UserRecord = Depends(get_current_user)) -> MemoryListResponse:
    raw = await service.get_all(user.id)
    return MemoryListResponse(
        items=[MemoryItem(id=m.get("id", ""), memory=m.get("memory", "")) for m in raw]
    )


@router.delete("/{memory_id}", status_code=204)
async def delete_memory(memory_id: str, user: UserRecord = Depends(get_current_user)) -> None:
    deleted = await service.delete_one(user.id, memory_id)
    if not deleted:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Memory not found")


@router.delete("", status_code=204)
async def clear_memories(user: UserRecord = Depends(get_current_user)) -> None:
    await service.wipe(user.id)
