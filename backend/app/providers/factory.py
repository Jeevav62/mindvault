"""Build FallbackRouters from settings, respecting the configured order.

Multi-key support: if a provider has N keys configured, each key becomes
a separate slot in the chain. Example with 2 Groq keys + 2 Cerebras keys:
  Groq(k1) → Groq(k2) → Cerebras(k1) → Cerebras(k2)
On rate-limit/quota, router automatically advances to the next slot.
"""
from __future__ import annotations

from functools import lru_cache

from app.config import _csv, get_settings

from .base import EmbeddingProvider, LLMProvider
from .embeddings import GeminiEmbeddingProvider, VoyageProvider
from .llm import CerebrasProvider, GroqProvider
from .router import FallbackRouter


def _build_llm_slots(name: str) -> list[LLMProvider]:
    s = get_settings()
    if name == "groq":
        return [GroqProvider(api_key=k, model=s.groq_model) for k in _csv(s.groq_api_keys)]
    if name == "cerebras":
        return [CerebrasProvider(api_key=k, model=s.cerebras_model) for k in _csv(s.cerebras_api_keys)]
    raise ValueError(f"unknown LLM provider: {name}")


def _build_embedding_slots(name: str) -> list[EmbeddingProvider]:
    s = get_settings()
    if name == "voyage":
        return [VoyageProvider(api_key=k, model=s.voyage_model, dim=s.embedding_dim) for k in _csv(s.voyage_api_keys)]
    if name == "gemini":
        return [GeminiEmbeddingProvider(api_key=k, model=s.gemini_embed_model, dim=s.embedding_dim) for k in _csv(s.gemini_api_keys)]
    raise ValueError(f"unknown embedding provider: {name}")


@lru_cache
def get_llm_router() -> FallbackRouter[LLMProvider]:
    s = get_settings()
    slots: list[LLMProvider] = []
    for name in s.llm_provider_order:
        slots.extend(_build_llm_slots(name))
    return FallbackRouter(slots, kind="llm")


@lru_cache
def get_embedding_router() -> FallbackRouter[EmbeddingProvider]:
    s = get_settings()
    slots: list[EmbeddingProvider] = []
    for name in s.embedding_provider_order:
        slots.extend(_build_embedding_slots(name))
    return FallbackRouter(slots, kind="embedding")
