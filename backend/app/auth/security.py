"""Password hashing (Argon2) and JWT issue/verify.

Argon2id is the current best-practice password KDF (memory-hard, resists GPU
cracking). JWTs are HS256-signed with JWT_SECRET; access tokens are short-lived,
refresh tokens long-lived, distinguished by the `type` claim.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from app.config import get_settings

_ph = PasswordHasher()

TokenType = Literal["access", "refresh", "approval"]


# ── Passwords ──────────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    try:
        return _ph.verify(hashed, password)
    except VerifyMismatchError:
        return False


def needs_rehash(hashed: str) -> bool:
    """True if Argon2 params changed and the hash should be upgraded on login."""
    return _ph.check_needs_rehash(hashed)


# ── JWT ────────────────────────────────────────────────────────────────────

class TokenError(Exception):
    """Invalid/expired/wrong-type token."""


def _create_token(sub: str, token_type: TokenType, ttl: timedelta, extra: dict | None = None) -> str:
    s = get_settings()
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": sub,
        "type": token_type,
        "iat": now,
        "exp": now + ttl,
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, s.jwt_secret, algorithm=s.jwt_algorithm)


def create_access_token(user_id: str, extra: dict | None = None) -> str:
    s = get_settings()
    return _create_token(user_id, "access", timedelta(minutes=s.jwt_access_ttl_min), extra)


def create_refresh_token(user_id: str) -> str:
    s = get_settings()
    return _create_token(user_id, "refresh", timedelta(days=s.jwt_refresh_ttl_days))


def create_approval_token(user_id: str) -> str:
    """Short-lived token embedded in the approve-link email. Valid 48 hours."""
    return _create_token(user_id, "approval", timedelta(hours=48))


def decode_token(token: str, *, expected_type: TokenType) -> dict[str, Any]:
    s = get_settings()
    try:
        payload = jwt.decode(token, s.jwt_secret, algorithms=[s.jwt_algorithm])
    except jwt.ExpiredSignatureError as exc:
        raise TokenError("token expired") from exc
    except jwt.PyJWTError as exc:
        raise TokenError(f"invalid token: {exc}") from exc
    if payload.get("type") != expected_type:
        raise TokenError(f"expected {expected_type} token, got {payload.get('type')}")
    return payload
