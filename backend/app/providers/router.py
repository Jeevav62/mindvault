"""FallbackRouter — try an ordered list of providers, fail over on retryable
errors, log which provider served each request.

Usage:
    router = FallbackRouter([groq, cerebras], kind="llm")
    text = await router.run(lambda p: p.complete(messages))

The router is provider-agnostic: it just calls the supplied coroutine factory
against each provider until one succeeds. Non-retryable errors (bad request,
auth) abort immediately — failing over would hit the same error everywhere.
"""
from __future__ import annotations

import logging
from typing import AsyncIterator, Awaitable, Callable, Generic, TypeVar

from .base import ProviderError

logger = logging.getLogger("providers.router")

P = TypeVar("P")  # provider type
R = TypeVar("R")  # result type


class AllProvidersFailed(ProviderError):
    """Every provider in the chain failed."""


class FallbackRouter(Generic[P]):
    def __init__(self, providers: list[P], *, kind: str) -> None:
        if not providers:
            raise ValueError(f"FallbackRouter({kind}) needs at least one provider")
        self.providers = providers
        self.kind = kind

    @property
    def primary(self) -> P:
        return self.providers[0]

    async def run_stream(
        self, op: Callable[[P], "AsyncIterator[str]"]
    ) -> "AsyncIterator[str]":
        errors: list[str] = []
        for provider in self.providers:
            name = getattr(provider, "name", provider.__class__.__name__)
            try:
                async for token in op(provider):
                    yield token
                if errors:
                    logger.info("[%s] stream served by fallback '%s'", self.kind, name)
                return
            except ProviderError as exc:
                errors.append(f"{name}: {exc}")
                if not exc.retryable:
                    raise
                logger.warning("[%s] '%s' stream failed (%s), trying next", self.kind, name, exc)
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{name}: unexpected {exc!r}")
                logger.warning("[%s] '%s' unexpected stream error, trying next", self.kind, name)
        raise AllProvidersFailed(f"all {self.kind} providers stream failed: {'; '.join(errors)}")

    async def run(self, op: Callable[[P], Awaitable[R]]) -> R:
        errors: list[str] = []
        for provider in self.providers:
            name = getattr(provider, "name", provider.__class__.__name__)
            try:
                result = await op(provider)
                if errors:  # we fell over at least once
                    logger.info("[%s] served by fallback '%s'", self.kind, name)
                else:
                    logger.debug("[%s] served by '%s'", self.kind, name)
                return result
            except ProviderError as exc:
                errors.append(f"{name}: {exc}")
                if not exc.retryable:
                    logger.error("[%s] '%s' non-retryable: %s", self.kind, name, exc)
                    raise
                logger.warning(
                    "[%s] '%s' failed (%s), trying next provider", self.kind, name, exc
                )
            except Exception as exc:  # noqa: BLE001 — unexpected, treat as retryable
                errors.append(f"{name}: unexpected {exc!r}")
                logger.warning(
                    "[%s] '%s' unexpected error (%r), trying next", self.kind, name, exc
                )
        raise AllProvidersFailed(
            f"all {self.kind} providers failed: {'; '.join(errors)}"
        )
