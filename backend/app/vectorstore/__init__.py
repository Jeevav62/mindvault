"""Vector store package — public API matches old vectorstore.py for drop-in compat."""
from __future__ import annotations

from functools import lru_cache

from app.config import get_settings

from .base import Chunk, Hit, VectorStore, VectorStoreError
from .pinecone_store import PineconeStore
from .qdrant_store import QdrantStore
from .router import AllStoresFailed, VectorStoreRouter

__all__ = ["Chunk", "Hit", "ensure_collection", "upsert_chunks", "search", "delete_doc", "aclose"]


@lru_cache
def _get_router() -> VectorStoreRouter:
    s = get_settings()
    stores: list[VectorStore] = []
    for name in s.vector_store_order:
        if name == "qdrant":
            stores.append(QdrantStore())
        elif name == "pinecone":
            stores.append(PineconeStore())
    return VectorStoreRouter(stores)


async def ensure_collection() -> None:
    await _get_router().ensure_collection()


async def upsert_chunks(
    user_id: str, chunks: list[Chunk], vectors: list[list[float]]
) -> int:
    return await _get_router().upsert_chunks(user_id, chunks, vectors)


async def search(
    user_id: str, query_vector: list[float], *, top_k: int = 5, doc_ids: list[str] | None = None
) -> list[Hit]:
    return await _get_router().search(user_id, query_vector, top_k=top_k, doc_ids=doc_ids)


async def delete_doc(user_id: str, doc_id: str) -> None:
    await _get_router().delete_doc(user_id, doc_id)


async def aclose() -> None:
    await _get_router().aclose()
