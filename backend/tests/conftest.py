import base64
import os

import pytest

# Ensure required secrets exist before settings is first read.
os.environ.setdefault("JWT_SECRET", "test-secret-please-ignore-but-make-it-32-bytes+")
os.environ.setdefault(
    "CRYPTO_MASTER_KEY", base64.b64encode(os.urandom(32)).decode()
)
# Auth tests exercise pure signup/login mechanics, not the admin-approval gate.
os.environ.setdefault("REQUIRE_APPROVAL", "false")


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    from app.auth import repository
    from app.config import get_settings
    from app.main import create_app

    get_settings.cache_clear()
    repository._repo = None  # fresh in-memory user store per test
    with TestClient(create_app()) as c:
        yield c
