"""VectorStoreRouter: tries stores in order, falls back on VectorStoreError."""
from __future__ import annotations

import logging

from .base import Chunk, Hit, VectorStore, VectorStoreError

logger = logging.getLogger(__name__)


class AllStoresFailed(Exception):
    pass


class VectorStoreRouter:
    def __init__(self, stores: list[VectorStore]) -> None:
        self._stores = stores

    async def ensure_collection(self) -> None:
        for store in self._stores:
            try:
                await store.ensure_collection()
                return
            except VectorStoreError as exc:
                logger.warning("vectorstore %s ensure_collection failed: %s", store.name, exc)
        raise AllStoresFailed("all vector stores failed ensure_collection")

    async def upsert_chunks(
        self, user_id: str, chunks: list[Chunk], vectors: list[list[float]]
    ) -> int:
        for store in self._stores:
            try:
                n = await store.upsert_chunks(user_id, chunks, vectors)
                if store.name != self._stores[0].name:
                    logger.info("vectorstore fallback: used %s for upsert", store.name)
                return n
            except VectorStoreError as exc:
                logger.warning("vectorstore %s upsert failed: %s — trying next", store.name, exc)
        raise AllStoresFailed("all vector stores failed upsert_chunks")

    async def search(
        self, user_id: str, query_vector: list[float], *, top_k: int = 5
    ) -> list[Hit]:
        for store in self._stores:
            try:
                hits = await store.search(user_id, query_vector, top_k=top_k)
                if store.name != self._stores[0].name:
                    logger.info("vectorstore fallback: used %s for search", store.name)
                return hits
            except VectorStoreError as exc:
                logger.warning("vectorstore %s search failed: %s — trying next", store.name, exc)
        raise AllStoresFailed("all vector stores failed search")

    async def aclose(self) -> None:
        for store in self._stores:
            try:
                await store.aclose()
            except Exception:
                pass
