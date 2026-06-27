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

# Hermetic tests: force the in-memory user store. Without this, a developer's
# real .env (Supabase + crypto key) leaks in — tests hit the live DB, see
# leftover rows (409), and CryptoError on emails encrypted under the real key.
# Empty values make get_user_repository() fall back to InMemoryUserRepository.
os.environ["SUPABASE_URL"] = ""
os.environ["SUPABASE_SERVICE_KEY"] = ""
os.environ["DATABASE_URL"] = ""


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    from app.auth import repository
    from app.config import get_settings
    from app.limiter import limiter
    from app.main import create_app

    get_settings.cache_clear()
    repository._repo = None  # fresh in-memory user store per test
    # TestClient shares one client IP, so per-IP rate limits accumulate across
    # the suite and spuriously 429 later signups. Disable for tests.
    limiter.enabled = False
    with TestClient(create_app()) as c:
        yield c
