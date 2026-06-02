"""AES-256-GCM round-trips and tamper detection."""
import base64
import os

import pytest

from app.config import get_settings
from app.crypto import (
    decrypt_blob,
    decrypt_field,
    encrypt_blob,
    encrypt_field,
    generate_master_key,
)
from app.crypto.aes import CryptoError


@pytest.fixture(autouse=True)
def _set_key(monkeypatch):
    # Inject a valid 32-byte key for the duration of each test.
    get_settings.cache_clear()
    monkeypatch.setenv("CRYPTO_MASTER_KEY", generate_master_key())
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_blob_round_trip():
    data = os.urandom(4096)
    assert decrypt_blob(encrypt_blob(data)) == data


def test_field_round_trip():
    secret = "user@example.com"
    token = encrypt_field(secret)
    assert token != secret  # actually encrypted
    assert decrypt_field(token) == secret


def test_nonce_makes_ciphertext_unique():
    data = b"same plaintext"
    assert encrypt_blob(data) != encrypt_blob(data)  # random nonce each time


def test_aad_must_match():
    data = b"bound to user 42"
    enc = encrypt_blob(data, aad=b"user-42")
    assert decrypt_blob(enc, aad=b"user-42") == data
    with pytest.raises(CryptoError):
        decrypt_blob(enc, aad=b"user-99")  # wrong AAD -> auth fail


def test_tamper_detected():
    enc = bytearray(encrypt_blob(b"important"))
    enc[-1] ^= 0x01  # flip a bit in the tag
    with pytest.raises(CryptoError):
        decrypt_blob(bytes(enc))


def test_bad_key_length_rejected(monkeypatch):
    get_settings.cache_clear()
    monkeypatch.setenv("CRYPTO_MASTER_KEY", base64.b64encode(b"too-short").decode())
    get_settings.cache_clear()
    with pytest.raises(CryptoError):
        encrypt_blob(b"x")
