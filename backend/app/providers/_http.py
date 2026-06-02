"""Shared HTTP helpers: a pooled async client and status->error mapping."""
from __future__ import annotations

import httpx

from .base import ProviderBadRequest, ProviderUnavailable, QuotaError

# One shared client (connection pooling). Closed on app shutdown in main.py.
_client: httpx.AsyncClient | None = None


def client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0))
    return _client


async def aclose() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def raise_for_status(resp: httpx.Response, *, provider: str) -> None:
    """Translate an HTTP error response into the provider error taxonomy."""
    if resp.is_success:
        return
    code = resp.status_code
    body = resp.text[:500]
    if code in (402, 429):
        raise QuotaError(f"{code} quota/rate-limit: {body}", provider=provider)
    if 500 <= code < 600:
        raise ProviderUnavailable(f"{code} server error: {body}", provider=provider)
    # 400/401/403/404 — failing over won't help.
    raise ProviderBadRequest(f"{code}: {body}", provider=provider)


def wrap_transport_error(exc: httpx.HTTPError, *, provider: str) -> ProviderUnavailable:
    return ProviderUnavailable(f"transport error: {exc!r}", provider=provider)
