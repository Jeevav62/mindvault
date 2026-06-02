"""User persistence behind a small interface.

Two implementations:
  - SupabaseUserRepository: production, backed by a Supabase `users` table.
  - InMemoryUserRepository: dev/tests, used automatically when Supabase isn't
    configured so the API runs locally with zero external setup.

The email is stored encrypted-at-rest as a field (encrypt_field) to honour the
"field encryption" crypto requirement; we keep a deterministic email hash for
uniqueness/lookup since the ciphertext is non-deterministic (random nonce).
"""
from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from typing import Protocol

from app.config import get_settings
from app.crypto import decrypt_field, encrypt_field


@dataclass
class UserRecord:
    id: str
    email: str
    password_hash: str


def email_lookup_hash(email: str) -> str:
    """Deterministic hash for unique lookup of an otherwise-encrypted email."""
    return hashlib.sha256(email.strip().lower().encode()).hexdigest()


class UserExists(Exception):
    pass


class UserRepository(Protocol):
    async def get_by_email(self, email: str) -> UserRecord | None: ...
    async def get_by_id(self, user_id: str) -> UserRecord | None: ...
    async def create(self, email: str, password_hash: str) -> UserRecord: ...


# ── In-memory (dev / tests) ────────────────────────────────────────────────

class InMemoryUserRepository:
    def __init__(self) -> None:
        self._by_id: dict[str, UserRecord] = {}
        self._id_by_email_hash: dict[str, str] = {}

    async def get_by_email(self, email: str) -> UserRecord | None:
        uid = self._id_by_email_hash.get(email_lookup_hash(email))
        return self._by_id.get(uid) if uid else None

    async def get_by_id(self, user_id: str) -> UserRecord | None:
        return self._by_id.get(user_id)

    async def create(self, email: str, password_hash: str) -> UserRecord:
        eh = email_lookup_hash(email)
        if eh in self._id_by_email_hash:
            raise UserExists(email)
        rec = UserRecord(id=str(uuid.uuid4()), email=email, password_hash=password_hash)
        self._by_id[rec.id] = rec
        self._id_by_email_hash[eh] = rec.id
        return rec


# ── Supabase (production) ──────────────────────────────────────────────────

class SupabaseUserRepository:
    """Expects a Supabase table `users`:
        id uuid pk default gen_random_uuid(),
        email_enc text,        -- encrypt_field(email)
        email_hash text unique,
        password_hash text,
        created_at timestamptz default now()
    Enable RLS; this repo uses the service key (server-side only).
    """

    def __init__(self) -> None:
        from supabase import create_client  # imported lazily

        s = get_settings()
        self._db = create_client(s.supabase_url, s.supabase_service_key)

    def _row_to_record(self, row: dict) -> UserRecord:
        return UserRecord(
            id=row["id"],
            email=decrypt_field(row["email_enc"]),
            password_hash=row["password_hash"],
        )

    async def get_by_email(self, email: str) -> UserRecord | None:
        res = (
            self._db.table("users")
            .select("*")
            .eq("email_hash", email_lookup_hash(email))
            .limit(1)
            .execute()
        )
        return self._row_to_record(res.data[0]) if res.data else None

    async def get_by_id(self, user_id: str) -> UserRecord | None:
        res = self._db.table("users").select("*").eq("id", user_id).limit(1).execute()
        return self._row_to_record(res.data[0]) if res.data else None

    async def create(self, email: str, password_hash: str) -> UserRecord:
        eh = email_lookup_hash(email)
        existing = (
            self._db.table("users").select("id").eq("email_hash", eh).limit(1).execute()
        )
        if existing.data:
            raise UserExists(email)
        res = (
            self._db.table("users")
            .insert(
                {
                    "email_enc": encrypt_field(email),
                    "email_hash": eh,
                    "password_hash": password_hash,
                }
            )
            .execute()
        )
        return self._row_to_record(res.data[0])


# ── Selection ──────────────────────────────────────────────────────────────

_repo: UserRepository | None = None


def get_user_repository() -> UserRepository:
    """Supabase if configured, else in-memory (logged as a dev fallback)."""
    global _repo
    if _repo is None:
        s = get_settings()
        if s.supabase_url and s.supabase_service_key:
            _repo = SupabaseUserRepository()
        else:
            import logging

            logging.getLogger("auth").warning(
                "Supabase not configured — using in-memory user store (dev only)"
            )
            _repo = InMemoryUserRepository()
    return _repo
