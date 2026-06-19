"""Admin endpoints — only accessible to the configured ADMIN_EMAIL.

GET  /admin/users/pending        — list users awaiting approval
POST /admin/users/{id}/approve   — approve a pending user
POST /admin/users/{id}/reject    — reject a pending user
GET  /admin/approve-link?token=  — one-click approve from email link (token = auth)
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.auth.repository import UserRecord, get_user_repository
from app.auth.security import TokenError, decode_token
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


# ── One-click email approval ──────────────────────────────────────────────────

def _html_response(title: str, message: str, color: str, emoji: str) -> HTMLResponse:
    return HTMLResponse(f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{title}</title>
<style>
  body{{font-family:monospace;background:#0d0d0d;color:#e5e7eb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}}
  .card{{background:#141414;border:1px solid #262626;border-radius:16px;padding:48px 40px;text-align:center;max-width:400px}}
  .icon{{font-size:48px;margin-bottom:16px}}
  .title{{font-size:20px;font-weight:700;color:{color};margin-bottom:8px}}
  .msg{{font-size:13px;color:#9ca3af;line-height:1.6}}
  .brand{{font-size:13px;color:#22C55E;font-weight:700;margin-bottom:24px}}
</style></head>
<body><div class="card">
  <div class="brand">RAG.chat</div>
  <div class="icon">{emoji}</div>
  <div class="title">{title}</div>
  <div class="msg">{message}</div>
</div></body></html>""")


@router.get("/approve-link", response_class=HTMLResponse)
async def approve_via_link(token: str = Query(...)) -> HTMLResponse:
    """Called when admin clicks the link in the approval email. No login required — the JWT is the auth."""
    try:
        payload = decode_token(token, expected_type="approval")
    except TokenError as exc:
        return _html_response(
            "Link expired or invalid", f"Error: {exc}<br>Ask the user to sign up again.",
            "#F87171", "⚠️",
        )

    user_id = payload["sub"]
    repo = get_user_repository()
    user = await repo.get_by_id(user_id)
    if not user:
        return _html_response("User not found", "The user may have been deleted.", "#F87171", "⚠️")

    if user.status == "approved":
        return _html_response(
            "Already approved", f"{user.email} already has access.", "#22C55E", "✅"
        )

    await repo.set_status(user_id, "approved")
    return _html_response(
        "Access granted!",
        f"<strong style='color:#e5e7eb'>{user.email}</strong> can now sign in to RAG.chat.",
        "#22C55E", "✅",
    )
