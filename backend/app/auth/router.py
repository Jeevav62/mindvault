from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

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


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def signup(body: SignupRequest) -> TokenResponse:
    repo = get_user_repository()
    try:
        user = await repo.create(str(body.email), hash_password(body.password))
    except UserExists:
        raise HTTPException(status.HTTP_409_CONFLICT, "email already registered")
    return _tokens(user.id)


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest) -> TokenResponse:
    repo = get_user_repository()
    user = await repo.get_by_email(str(body.email))
    # Verify even on missing user to avoid leaking which emails exist (timing).
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials")
    return _tokens(user.id)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest) -> TokenResponse:
    try:
        payload = decode_token(body.refresh_token, expected_type="refresh")
    except TokenError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc))
    return _tokens(payload["sub"])


@router.get("/me", response_model=UserOut)
async def me(user: UserRecord = Depends(get_current_user)) -> UserOut:
    return UserOut(id=user.id, email=user.email)
