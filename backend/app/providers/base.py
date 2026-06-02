"""Provider interfaces and the error taxonomy the FallbackRouter switches on.

Every concrete provider raises one of these on failure so the router can decide
whether to fail over (retryable) or abort (non-retryable, e.g. bad request).
"""
from __future__ import annotations

import abc
from dataclasses import dataclass
from typing import Literal


# ── Error taxonomy ─────────────────────────────────────────────────────────

class ProviderError(Exception):
    """Base for all provider failures. Carries the provider name for logging."""

    retryable: bool = False

    def __init__(self, message: str, *, provider: str = "") -> None:
        super().__init__(message)
        self.provider = provider


class QuotaError(ProviderError):
    """Out of credits / rate-limited (HTTP 402/429). Fail over to next provider."""

    retryable = True


class ProviderUnavailable(ProviderError):
    """Network error, timeout, or 5xx. Fail over to next provider."""

    retryable = True


class ProviderBadRequest(ProviderError):
    """4xx other than quota (bad input, auth). NOT retryable — failing over
    to another provider would hit the same bad request."""

    retryable = False


# ── Messages ───────────────────────────────────────────────────────────────

Role = Literal["system", "user", "assistant"]


@dataclass
class ChatMessage:
    role: Role
    content: str

    def as_dict(self) -> dict[str, str]:
        return {"role": self.role, "content": self.content}


# ── Provider interfaces ────────────────────────────────────────────────────

class LLMProvider(abc.ABC):
    """A chat-completion provider."""

    name: str

    @abc.abstractmethod
    async def complete(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float = 0.2,
        max_tokens: int = 1024,
    ) -> str:
        """Return the assistant's text reply, or raise a ProviderError."""


class EmbeddingProvider(abc.ABC):
    """A text-embedding provider."""

    name: str
    dim: int

    @abc.abstractmethod
    async def embed(self, texts: list[str], *, input_type: str = "document") -> list[list[float]]:
        """Return one vector per input text, or raise a ProviderError."""
