"""Custom memory service — no mem0 extraction overhead.

Write path: our own LLM call (always short, never hits TPM limits) → Qdrant.
Read path:  Qdrant vector search / scroll (fast, reliable).
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from datetime import datetime

from qdrant_client import AsyncQdrantClient, models

from app.config import get_settings
from app.providers import get_embedding_router, get_llm_router
from app.providers.base import ChatMessage

logger = logging.getLogger(__name__)

COLLECTION = "user_memories"

_qdrant_client: AsyncQdrantClient | None = None
_collection_ready = False


def _get_qdrant() -> AsyncQdrantClient:
    global _qdrant_client
    if _qdrant_client is None:
        s = get_settings()
        _qdrant_client = AsyncQdrantClient(
            url=s.qdrant_url, api_key=s.qdrant_api_key or None
        )
    return _qdrant_client


async def _ensure_collection() -> None:
    global _collection_ready
    if _collection_ready:
        return
    s = get_settings()
    client = _get_qdrant()
    if not await client.collection_exists(COLLECTION):
        await client.create_collection(
            collection_name=COLLECTION,
            vectors_config=models.VectorParams(
                size=s.embedding_dim, distance=models.Distance.COSINE
            ),
        )
        await client.create_payload_index(
            collection_name=COLLECTION,
            field_name="user_id",
            field_schema=models.PayloadSchemaType.KEYWORD,
        )
        logger.info("Memory: created collection %s", COLLECTION)
    _collection_ready = True


async def warmup() -> None:
    try:
        await _ensure_collection()
        logger.info("Memory: Qdrant collection ready")
    except Exception as exc:
        logger.warning("Memory warmup failed: %s", exc)


# ── Extraction prompt ─────────────────────────────────────────────────────────

_EXTRACT_SYSTEM = (
    "Extract ONLY personal facts the user explicitly stated about THEMSELVES.\n"
    "INCLUDE: name, age, job title, employer, city/country, skills, hobbies, "
    "interests, goals, family members (name + relation), education, projects, opinions.\n"
    "EXCLUDE: questions they asked, greetings, anything about documents or AI assistants.\n"
    "Return a JSON array of SHORT fact strings (max 15 words each).\n"
    'No personal facts → return []. Example: ["name is Jeeva", "father is Vedachalam"]'
)


async def _extract_facts(text: str) -> list[str]:
    """LLM call to pull personal facts. Input capped at 1000 chars — always tiny prompt."""
    router = get_llm_router()
    msgs = [
        ChatMessage(role="system", content=_EXTRACT_SYSTEM),
        ChatMessage(role="user", content=text[:1000]),
    ]
    try:
        response = await router.run(lambda p: p.complete(msgs))
        m = re.search(r"\[.*?\]", response, re.DOTALL)
        if m:
            raw = json.loads(m.group())
            return [str(f).strip() for f in raw if str(f).strip()]
    except Exception as exc:
        logger.warning("fact extraction LLM failed: %s", exc)
    return []


# ── Public API ────────────────────────────────────────────────────────────────

def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(x * x for x in b) ** 0.5
    return dot / (na * nb) if na and nb else 0.0


async def _dedup_and_update(
    user_id: str,
    client: AsyncQdrantClient,
    fact: str,
    vec: list[float],
    threshold_dup: float = 0.92,
    threshold_conflict: float = 0.75,
) -> tuple[bool, str | None]:
    """
    Check new fact against existing memories.
    Returns (should_skip, old_point_id_to_delete).
    - score >= threshold_dup   → duplicate, skip
    - threshold_conflict <= score < threshold_dup → likely conflict/update, delete old
    - score < threshold_conflict → genuinely new fact
    """
    result = await client.query_points(
        collection_name=COLLECTION,
        query=vec,
        query_filter=models.Filter(
            must=[models.FieldCondition(key="user_id", match=models.MatchValue(value=user_id))]
        ),
        limit=1,
        with_payload=True,
    )
    if not result.points:
        return False, None
    top = result.points[0]
    score = top.score  # Qdrant returns cosine score directly
    if score >= threshold_dup:
        logger.debug("Skipping duplicate fact (score=%.3f): %s", score, fact)
        return True, None
    if score >= threshold_conflict:
        logger.info("Updating conflicting fact (score=%.3f): '%s' → '%s'",
                    score, top.payload.get("memory"), fact)
        return False, str(top.id)
    return False, None


async def add_turn(user_id: str, question: str, answer: str) -> None:
    """Extract personal facts, dedup/update against existing, store in Qdrant."""
    facts = await _extract_facts(question)
    if not facts:
        return
    try:
        emb_router = get_embedding_router()
        embeddings = await emb_router.run(
            lambda p: p.embed(facts, input_type="document")
        )
        await _ensure_collection()
        client = _get_qdrant()

        points_to_upsert: list[models.PointStruct] = []
        ids_to_delete: list[str] = []

        for fact, vec in zip(facts, embeddings):
            skip, old_id = await _dedup_and_update(user_id, client, fact, vec)
            if skip:
                continue
            if old_id:
                ids_to_delete.append(old_id)
            points_to_upsert.append(
                models.PointStruct(
                    id=str(uuid.uuid4()),
                    vector=vec,
                    payload={
                        "user_id": user_id,
                        "memory": fact,
                        "created_at": datetime.utcnow().isoformat(),
                    },
                )
            )

        if ids_to_delete:
            await client.delete(
                collection_name=COLLECTION,
                points_selector=models.PointIdsList(points=ids_to_delete),
            )
        if points_to_upsert:
            await client.upsert(collection_name=COLLECTION, points=points_to_upsert)
            logger.info("Stored %d fact(s), replaced %d for user %.8s",
                        len(points_to_upsert), len(ids_to_delete), user_id)
    except Exception as exc:
        logger.warning("memory write failed: %s", exc)


async def search(user_id: str, query: str, *, limit: int = 5) -> list[str]:
    """Retrieve top-k memories semantically relevant to query."""
    try:
        await _ensure_collection()
        emb_router = get_embedding_router()
        qvec = (
            await emb_router.run(lambda p: p.embed([query], input_type="query"))
        )[0]
        client = _get_qdrant()
        result = await client.query_points(
            collection_name=COLLECTION,
            query=qvec,
            query_filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="user_id", match=models.MatchValue(value=user_id)
                    )
                ]
            ),
            limit=limit,
        )
        return [r.payload["memory"] for r in result.points if r.payload.get("memory")]
    except Exception as exc:
        logger.warning("memory search failed: %s", exc)
        return []


async def get_all(user_id: str) -> list[dict]:
    """Fetch all stored memories for user (for the panel)."""
    try:
        await _ensure_collection()
        client = _get_qdrant()
        points, _ = await client.scroll(
            collection_name=COLLECTION,
            scroll_filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="user_id", match=models.MatchValue(value=user_id)
                    )
                ]
            ),
            limit=200,
            with_payload=True,
            with_vectors=False,
        )
        return [
            {"id": str(p.id), "memory": p.payload.get("memory", "")}
            for p in points
            if p.payload.get("memory")
        ]
    except Exception as exc:
        logger.warning("get_all failed: %s", exc)
        return []


async def delete_one(user_id: str, memory_id: str) -> bool:
    """Delete a single memory by id. Returns True if deleted."""
    try:
        await _ensure_collection()
        client = _get_qdrant()
        # Verify ownership before deleting
        results = await client.retrieve(
            collection_name=COLLECTION, ids=[memory_id], with_payload=True
        )
        if not results or results[0].payload.get("user_id") != user_id:
            return False
        await client.delete(
            collection_name=COLLECTION,
            points_selector=models.PointIdsList(points=[memory_id]),
        )
        return True
    except Exception as exc:
        logger.warning("delete_one failed: %s", exc)
        return False


async def wipe(user_id: str) -> None:
    """Delete all memories for user."""
    try:
        await _ensure_collection()
        client = _get_qdrant()
        await client.delete(
            collection_name=COLLECTION,
            points_selector=models.FilterSelector(
                filter=models.Filter(
                    must=[
                        models.FieldCondition(
                            key="user_id", match=models.MatchValue(value=user_id)
                        )
                    ]
                )
            ),
        )
        logger.info("Wiped memories for user %.8s", user_id)
    except Exception as exc:
        logger.warning("memory wipe failed: %s", exc)
