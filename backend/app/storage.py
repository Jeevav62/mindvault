"""Encrypted blob storage on local disk (S3 later).

Files are AES-256-GCM encrypted before hitting disk, with the user_id bound as
additional authenticated data so a blob can't be silently moved between users.
"""
from __future__ import annotations

import uuid
from pathlib import Path

from app.config import get_settings
from app.crypto import decrypt_blob, encrypt_blob


def _base_dir() -> Path:
    d = Path(get_settings().blob_store_dir)
    d.mkdir(parents=True, exist_ok=True)
    return d


def store_blob(user_id: str, data: bytes) -> str:
    """Encrypt and persist; return a relative blob path for the DB."""
    blob_id = f"{user_id}/{uuid.uuid4().hex}.enc"
    path = _base_dir() / blob_id
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(encrypt_blob(data, aad=user_id.encode()))
    return blob_id


def load_blob(user_id: str, blob_path: str) -> bytes:
    path = _base_dir() / blob_path
    return decrypt_blob(path.read_bytes(), aad=user_id.encode())
