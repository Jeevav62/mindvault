from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status

import asyncio

from app.config import get_settings
from app.limiter import limiter
from app.email import send_approval_request_email
from app.auth.security import create_approval_token

from .dependencies import get_current_user
from .repository import UserExists, UserRecord, get_user_repository
from .schemas import (
    LoginRequest,
    RefreshRequest,
    SignupRequest,
    TokenResponse,
    UserOut,
)
from .security import (
    TokenError,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _tokens(user_id: str) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(user_id),
        refresh_token=create_refresh_token(user_id),
    )


def _is_admin(email: str) -> bool:
    s = get_settings()
    return bool(s.admin_email) and email.lower() == s.admin_email.lower()


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
async def signup(request: Request, body: SignupRequest) -> TokenResponse:
    repo = get_user_repository()
    # Admin email auto-approved; everyone else starts pending
    initial_status = "approved" if _is_admin(str(body.email)) else "pending"
    try:
        user = await repo.create(str(body.email), hash_password(body.password), status=initial_status)
    except UserExists:
        raise HTTPException(status.HTTP_409_CONFLICT, "email already registered")
    if user.status == "pending":
        # Fire approval email to admin in background (don't block signup response)
        s = get_settings()
        if s.admin_email:
            approval_token = create_approval_token(user.id)
            approve_url = f"{s.app_base_url}/admin/approve-link?token={approval_token}"
            asyncio.create_task(
                send_approval_request_email(
                    new_user_email=str(body.email),
                    approve_url=approve_url,
                )
            )
        raise HTTPException(status.HTTP_403_FORBIDDEN, "pending_approval")
    return _tokens(user.id)


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
async def login(request: Request, body: LoginRequest) -> TokenResponse:
    repo = get_user_repository()
    user = await repo.get_by_email(str(body.email))
    # Always verify to avoid timing-based email enumeration
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials")

    # Admin email: auto-approve if somehow still pending (e.g. after DB migration)
    if user.status == "pending" and _is_admin(user.email):
        await repo.set_status(user.id, "approved")
        user.status = "approved"

    if user.status == "pending":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "pending_approval")
    if user.status == "rejected":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "access_denied")

    return _tokens(user.id)


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("30/minute")
async def refresh(request: Request, body: RefreshRequest) -> TokenResponse:
    try:
        payload = decode_token(body.refresh_token, expected_type="refresh")
    except TokenError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc))
    return _tokens(payload["sub"])


@router.get("/me", response_model=UserOut)
async def me(user: UserRecord = Depends(get_current_user)) -> UserOut:
    return UserOut(id=user.id, email=user.email)
