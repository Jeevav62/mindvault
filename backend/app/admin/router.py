"""Admin endpoints — only accessible to the configured ADMIN_EMAIL.

GET  /admin/users/pending      — list users awaiting approval
POST /admin/users/{id}/approve — approve a pending user
POST /admin/users/{id}/reject  — reject a pending user
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.auth.repository import UserRecord, get_user_repository
from app.config import get_settings

router = APIRouter(prefix="/admin", tags=["admin"])


class PendingUserOut(BaseModel):
    id: str
    email: str


def _require_admin(user: UserRecord = Depends(get_current_user)) -> UserRecord:
    s = get_settings()
    if not s.admin_email or user.email.lower() != s.admin_email.lower():
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin only")
    return user


@router.get("/users/pending", response_model=list[PendingUserOut])
async def get_pending_users(_: UserRecord = Depends(_require_admin)) -> list[PendingUserOut]:
    repo = get_user_repository()
    users = await repo.get_pending()
    return [PendingUserOut(id=u.id, email=u.email) for u in users]


@router.post("/users/{user_id}/approve", status_code=status.HTTP_204_NO_CONTENT)
async def approve_user(user_id: str, _: UserRecord = Depends(_require_admin)) -> None:
    repo = get_user_repository()
    user = await repo.get_by_id(user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    await repo.set_status(user_id, "approved")


@router.post("/users/{user_id}/reject", status_code=status.HTTP_204_NO_CONTENT)
async def reject_user(user_id: str, _: UserRecord = Depends(_require_admin)) -> None:
    repo = get_user_repository()
    user = await repo.get_by_id(user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    await repo.set_status(user_id, "rejected")
