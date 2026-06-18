"""Mem0-backed long-term user memory.

Mem0's `Memory` is a sync SDK; every call is wrapped in `asyncio.to_thread`
to stay compatible with the async FastAPI app.

Vector store priority: Qdrant Cloud → in-memory Qdrant (fallback if cloud is down).
In-memory Qdrant loses data on process restart but keeps the app functional.
"""
from __future__ import annotations

import asyncio
import logging

from mem0 import Memory

from app.config import _csv, get_settings

logger = logging.getLogger(__name__)

# Module-level singleton — initialized once, reused across requests.
_memory_instance: Memory | None = None


def _get_memory() -> Memory:
    global _memory_instance
    if _memory_instance is not None:
        return _memory_instance

    s = get_settings()
    groq_keys = _csv(s.groq_api_keys)
    gemini_keys = _csv(s.gemini_api_keys)

    # Use the LAST Groq key for mem0 extraction so it has its own TPM budget
    # separate from chat traffic (which cycles keys 0..N-1 first).
    mem0_groq_key = groq_keys[-1] if groq_keys else ""

    base = {
        "llm": {
            "provider": "groq",
            "config": {
                # llama-3.1-8b-instant: 6K TPM per key on free tier.
                # Use dedicated last key so chat rotation doesn't starve extraction.
                # gemma2-9b-it: 15k TPM (vs 8b-instant's 6k) — needed because
                # mem0's extraction prompt hits ~10k tokens with existing memories.
                "model": "gemma2-9b-it",
                "api_key": mem0_groq_key,
            },
        },
        "embedder": {
            "provider": "gemini",
            "config": {
                "model": s.gemini_embed_model,
                "embedding_dims": s.embedding_dim,
                "api_key": gemini_keys[0] if gemini_keys else "",
            },
        },
        # Only extract durable personal facts the USER stated — never assistant actions.
        "custom_fact_extraction_prompt": (
            "Extract ONLY durable personal facts the USER explicitly stated.\n"
            "EXTRACT: name, age, job, employer, location, skills, hobbies, interests, "
            "goals, family (name+relation), education, projects, opinions.\n"
            "SKIP: assistant actions, greetings, small talk, questions the user asked, "
            "timestamps, session metadata, anything starting with 'User was asked' or "
            "'Assistant'.\n"
            "No durable facts → return empty list."
        ),
    }

    # Try Qdrant Cloud first; fall back to in-memory if unreachable.
    candidates = [
        {
            "provider": "qdrant",
            "config": {
                "collection_name": s.mem0_collection,
                "embedding_model_dims": s.embedding_dim,
                "url": s.qdrant_url,
                "api_key": s.qdrant_api_key or None,
            },
        },
        {
            "provider": "qdrant",
            "config": {
                "collection_name": s.mem0_collection,
                "embedding_model_dims": s.embedding_dim,
                "path": ":memory:",
            },
        },
    ]

    last_exc: Exception | None = None
    for vs in candidates:
        try:
            _memory_instance = Memory.from_config({**base, "vector_store": vs})
            if vs["config"].get("path") == ":memory:":
                logger.warning("Mem0: Qdrant Cloud unreachable — using in-memory store (data lost on restart)")
            else:
                logger.info("Mem0: connected to Qdrant Cloud")
            return _memory_instance
        except Exception as exc:
            last_exc = exc
            logger.warning("Mem0 vector store %s failed: %s — trying next", vs["provider"], exc)

    raise RuntimeError(f"Mem0: all vector store backends failed. Last error: {last_exc}")


async def add_turn(user_id: str, question: str, answer: str) -> None:
    mem = _get_memory()
    # Only pass the user message — assistant responses contain no personal facts
    # and cause mem0 to extract noise like "assistant greeted user".
    messages = [{"role": "user", "content": question}]
    await asyncio.to_thread(mem.add, messages, user_id=user_id)


async def search(user_id: str, query: str, *, limit: int = 5) -> list[str]:
    mem = _get_memory()
    result = await asyncio.to_thread(mem.search, query, filters={"user_id": user_id}, limit=limit)
    items = result.get("results", result) if isinstance(result, dict) else result
    return [item["memory"] for item in items if item.get("memory")]


async def get_all(user_id: str) -> list[dict]:
    mem = _get_memory()
    result = await asyncio.to_thread(mem.get_all, user_id=user_id)
    return result.get("results", result) if isinstance(result, dict) else result


async def wipe(user_id: str) -> None:
    mem = _get_memory()
    await asyncio.to_thread(mem.delete_all, user_id=user_id)
