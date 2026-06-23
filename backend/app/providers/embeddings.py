"""Embedding providers: Voyage (primary) and Gemini (fallback).

IMPORTANT — dimension parity: a Qdrant collection has a FIXED vector size, and
vectors from different models are only comparable if they share that size AND,
ideally, the same model. We pin both providers to `settings.embedding_dim`
(default 1024): Voyage `voyage-3` is natively 1024; Gemini `gemini-embedding-001`
supports `outputDimensionality` so we request 1024 to match.

Caveat: even at equal dimension, cross-model vectors live in different spaces.
Fallback embeddings preserve *availability*; for best retrieval quality, content
indexed under the fallback should ideally be re-embedded once the primary
recovers. Tracked as a Phase 5 hardening item.
"""
from __future__ import annotations

import httpx

from . import _http
from .base import EmbeddingProvider, ProviderBadRequest, ProviderUnavailable


class VoyageProvider(EmbeddingProvider):
    base_url = "https://api.voyageai.com/v1/embeddings"

    def __init__(self, *, api_key: str, model: str, dim: int) -> None:
        self.api_key = api_key
        self.model = model
        self.dim = dim
        self.name = "voyage"

    async def embed(
        self, texts: list[str], *, input_type: str = "document"
    ) -> list[list[float]]:
        if not self.api_key:
            raise ProviderUnavailable("no API key configured", provider=self.name)
        payload = {"input": texts, "model": self.model, "input_type": input_type}
        headers = {"Authorization": f"Bearer {self.api_key}"}
        try:
            resp = await _http.client().post(self.base_url, json=payload, headers=headers)
        except httpx.HTTPError as exc:
            raise _http.wrap_transport_error(exc, provider=self.name) from exc
        _http.raise_for_status(resp, provider=self.name)
        data = resp.json()
        try:
            # Voyage returns items in input order, but sort by index to be safe.
            items = sorted(data["data"], key=lambda d: d["index"])
            return [item["embedding"] for item in items]
        except (KeyError, TypeError) as exc:
            raise ProviderBadRequest(
                f"unexpected response shape: {data}", provider=self.name
            ) from exc


class GeminiEmbeddingProvider(EmbeddingProvider):
    """Uses :batchEmbedContents with outputDimensionality to match `dim`."""

    base = "https://generativelanguage.googleapis.com/v1beta/models"

    # Gemini caps batchEmbedContents at 100 requests per call; sub-batch above this.
    MAX_BATCH = 100

    # Map our generic input_type to Gemini taskType.
    _TASK = {"document": "RETRIEVAL_DOCUMENT", "query": "RETRIEVAL_QUERY"}

    def __init__(self, *, api_key: str, model: str, dim: int) -> None:
        self.api_key = api_key
        self.model = model
        self.dim = dim
        self.name = "gemini"

    async def embed(
        self, texts: list[str], *, input_type: str = "document"
    ) -> list[list[float]]:
        if not self.api_key:
            raise ProviderUnavailable("no API key configured", provider=self.name)
        out: list[list[float]] = []
        for start in range(0, len(texts), self.MAX_BATCH):
            out.extend(await self._embed_batch(texts[start : start + self.MAX_BATCH], input_type))
        return out

    async def _embed_batch(
        self, texts: list[str], input_type: str
    ) -> list[list[float]]:
        task = self._TASK.get(input_type, "RETRIEVAL_DOCUMENT")
        url = f"{self.base}/{self.model}:batchEmbedContents?key={self.api_key}"
        body = {
            "requests": [
                {
                    "model": f"models/{self.model}",
                    "content": {"parts": [{"text": t}]},
                    "taskType": task,
                    "outputDimensionality": self.dim,
                }
                for t in texts
            ]
        }
        try:
            resp = await _http.client().post(url, json=body)
        except httpx.HTTPError as exc:
            raise _http.wrap_transport_error(exc, provider=self.name) from exc
        _http.raise_for_status(resp, provider=self.name)
        data = resp.json()
        try:
            return [e["values"] for e in data["embeddings"]]
        except (KeyError, TypeError) as exc:
            raise ProviderBadRequest(
                f"unexpected response shape: {data}", provider=self.name
            ) from exc
