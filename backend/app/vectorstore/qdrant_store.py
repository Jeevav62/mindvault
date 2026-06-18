"""Qdrant vector store implementation."""
from __future__ import annotations

import uuid

from qdrant_client import AsyncQdrantClient, models

from app.config import get_settings

from .base import Chunk, Hit, VectorStore, VectorStoreError


class QdrantStore(VectorStore):
    _client: AsyncQdrantClient | None = None

    @property
    def name(self) -> str:
        return "qdrant"

    def _get_client(self) -> AsyncQdrantClient:
        if self._client is None:
            s = get_settings()
            self._client = AsyncQdrantClient(
                url=s.qdrant_url, api_key=s.qdrant_api_key or None
            )
        return self._client

    async def ensure_collection(self) -> None:
        s = get_settings()
        client = self._get_client()
        try:
            if not await client.collection_exists(s.qdrant_collection):
                await client.create_collection(
                    collection_name=s.qdrant_collection,
                    vectors_config=models.VectorParams(
                        size=s.embedding_dim, distance=models.Distance.COSINE
                    ),
                )
                await client.create_payload_index(
                    collection_name=s.qdrant_collection,
                    field_name="user_id",
                    field_schema=models.PayloadSchemaType.KEYWORD,
                )
        except Exception as exc:
            raise VectorStoreError(str(exc), store=self.name) from exc

    async def upsert_chunks(
        self, user_id: str, chunks: list[Chunk], vectors: list[list[float]]
    ) -> int:
        s = get_settings()
        points = [
            models.PointStruct(
                id=str(uuid.uuid4()),
                vector=vec,
                payload={
                    "user_id": user_id,
                    "doc_id": ch.doc_id,
                    "chunk_index": ch.chunk_index,
                    "chunk_text": ch.text,
                    "source": ch.source,
                    "modality": ch.modality,
                    "page_number": ch.page_number,
                },
            )
            for ch, vec in zip(chunks, vectors)
        ]
        try:
            await self._get_client().upsert(
                collection_name=s.qdrant_collection, points=points
            )
        except Exception as exc:
            raise VectorStoreError(str(exc), store=self.name) from exc
        return len(points)

    async def search(
        self, user_id: str, query_vector: list[float], *, top_k: int = 5
    ) -> list[Hit]:
        s = get_settings()
        try:
            res = await self._get_client().query_points(
                collection_name=s.qdrant_collection,
                query=query_vector,
                limit=top_k,
                query_filter=models.Filter(
                    must=[
                        models.FieldCondition(
                            key="user_id", match=models.MatchValue(value=user_id)
                        )
                    ]
                ),
                with_payload=True,
            )
        except Exception as exc:
            raise VectorStoreError(str(exc), store=self.name) from exc
        hits: list[Hit] = []
        for p in res.points:
            payload = p.payload or {}
            hits.append(
                Hit(
                    text=payload.get("chunk_text", ""),
                    source=payload.get("source", ""),
                    doc_id=payload.get("doc_id", ""),
                    chunk_index=payload.get("chunk_index", 0),
                    score=p.score,
                    page_number=payload.get("page_number"),
                )
            )
        return hits

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.close()
            self._client = None
