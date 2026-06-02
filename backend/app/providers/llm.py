"""LLM providers: Groq and Cerebras.

Both expose an OpenAI-compatible /chat/completions endpoint, so they share a
base class and differ only in base URL, model, and key.
"""
from __future__ import annotations

import httpx

from . import _http
from .base import ChatMessage, LLMProvider, ProviderBadRequest


class _OpenAICompatLLM(LLMProvider):
    base_url: str

    def __init__(self, *, api_key: str, model: str, name: str) -> None:
        self.api_key = api_key
        self.model = model
        self.name = name

    async def complete(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float = 0.2,
        max_tokens: int = 1024,
    ) -> str:
        if not self.api_key:
            # No key configured — treat as bad request so router skips? No:
            # a missing key for THIS provider should fail over, so mark retryable.
            from .base import ProviderUnavailable

            raise ProviderUnavailable("no API key configured", provider=self.name)

        payload = {
            "model": self.model,
            "messages": [m.as_dict() for m in messages],
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        headers = {"Authorization": f"Bearer {self.api_key}"}
        try:
            resp = await _http.client().post(
                f"{self.base_url}/chat/completions", json=payload, headers=headers
            )
        except httpx.HTTPError as exc:
            raise _http.wrap_transport_error(exc, provider=self.name) from exc

        _http.raise_for_status(resp, provider=self.name)
        data = resp.json()
        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError) as exc:
            raise ProviderBadRequest(
                f"unexpected response shape: {data}", provider=self.name
            ) from exc


class GroqProvider(_OpenAICompatLLM):
    base_url = "https://api.groq.com/openai/v1"

    def __init__(self, *, api_key: str, model: str) -> None:
        super().__init__(api_key=api_key, model=model, name="groq")


class CerebrasProvider(_OpenAICompatLLM):
    base_url = "https://api.cerebras.ai/v1"

    def __init__(self, *, api_key: str, model: str) -> None:
        super().__init__(api_key=api_key, model=model, name="cerebras")
