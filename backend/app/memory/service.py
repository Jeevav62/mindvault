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

    base = {
        "llm": {
            "provider": "groq",
            "config": {
                "model": s.groq_model,
                "api_key": groq_keys[0] if groq_keys else "",
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
        # Only store durable personal facts — not greetings, timestamps, or assistant actions.
        "custom_fact_extraction_prompt": (
            "Extract only important, durable personal facts about the user: "
            "their name, job title, profession, technical skills, interests, hobbies, "
            "preferences, goals, or significant personal information they have shared. "
            "Do NOT store: greetings, pleasantries, conversation timestamps, "
            "what the assistant said or did, or any ephemeral/one-off context."
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
    messages = [
        {"role": "user", "content": question},
        {"role": "assistant", "content": answer},
    ]
    # mem0ai 2.x: add() still takes user_id= kwarg; only search/get_all/delete_all use filters=
    await asyncio.to_thread(mem.add, messages, user_id=user_id)


async def search(user_id: str, query: str, *, limit: int = 5) -> list[str]:
    mem = _get_memory()
    result = await asyncio.to_thread(mem.search, query, filters={"user_id": user_id}, limit=limit)
    items = result.get("results", result) if isinstance(result, dict) else result
    return [item["memory"] for item in items if item.get("memory")]


async def get_all(user_id: str) -> list[dict]:
    mem = _get_memory()
    result = await asyncio.to_thread(mem.get_all, filters={"user_id": user_id})
    return result.get("results", result) if isinstance(result, dict) else result


async def wipe(user_id: str) -> None:
    mem = _get_memory()
    await asyncio.to_thread(mem.delete_all, filters={"user_id": user_id})
