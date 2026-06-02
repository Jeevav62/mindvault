"""AES-256-GCM encryption helpers for data at rest.

Two surfaces:
  - blob  : encrypt/decrypt raw file bytes (uploaded documents).
  - field : encrypt/decrypt short strings (sensitive DB fields), returned as
            a urlsafe-base64 string so it stores cleanly in a text column.

Wire format (both surfaces): nonce(12 bytes) || ciphertext || tag. GCM appends
the 16-byte auth tag to the ciphertext, so we only prepend the nonce.

The master key is a base64-encoded 32-byte value from CRYPTO_MASTER_KEY.
Generate one with:
    python -c "from app.crypto import generate_master_key; print(generate_master_key())"
"""
from __future__ import annotations

import base64
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import get_settings

_NONCE_BYTES = 12  # 96-bit nonce, recommended for GCM


class CryptoError(Exception):
    """Raised when decryption fails (tampered data or wrong key)."""


def generate_master_key() -> str:
    """Return a fresh base64-encoded 32-byte key for CRYPTO_MASTER_KEY."""
    return base64.b64encode(os.urandom(32)).decode()


def _load_key() -> bytes:
    raw = get_settings().crypto_master_key
    if not raw:
        raise CryptoError("CRYPTO_MASTER_KEY is not set")
    try:
        key = base64.b64decode(raw)
    except Exception as exc:  # noqa: BLE001
        raise CryptoError("CRYPTO_MASTER_KEY is not valid base64") from exc
    if len(key) != 32:
        raise CryptoError("CRYPTO_MASTER_KEY must decode to exactly 32 bytes")
    return key


def _encrypt(plaintext: bytes, aad: bytes | None = None) -> bytes:
    aesgcm = AESGCM(_load_key())
    nonce = os.urandom(_NONCE_BYTES)
    ct = aesgcm.encrypt(nonce, plaintext, aad)
    return nonce + ct


def _decrypt(payload: bytes, aad: bytes | None = None) -> bytes:
    if len(payload) <= _NONCE_BYTES:
        raise CryptoError("ciphertext too short")
    nonce, ct = payload[:_NONCE_BYTES], payload[_NONCE_BYTES:]
    aesgcm = AESGCM(_load_key())
    try:
        return aesgcm.decrypt(nonce, ct, aad)
    except InvalidTag as exc:
        raise CryptoError("decryption failed: bad key or tampered data") from exc


# ── Blob surface (file bytes) ──────────────────────────────────────────────

def encrypt_blob(data: bytes, aad: bytes | None = None) -> bytes:
    """Encrypt raw bytes. `aad` (e.g. user_id) is authenticated, not encrypted."""
    return _encrypt(data, aad)


def decrypt_blob(payload: bytes, aad: bytes | None = None) -> bytes:
    return _decrypt(payload, aad)


# ── Field surface (short strings -> base64 text) ───────────────────────────

def encrypt_field(value: str, aad: bytes | None = None) -> str:
    """Encrypt a string and return urlsafe-base64 text for DB storage."""
    return base64.urlsafe_b64encode(_encrypt(value.encode(), aad)).decode()


def decrypt_field(token: str, aad: bytes | None = None) -> str:
    try:
        payload = base64.urlsafe_b64decode(token.encode())
    except Exception as exc:  # noqa: BLE001
        raise CryptoError("field token is not valid base64") from exc
    return _decrypt(payload, aad).decode()
