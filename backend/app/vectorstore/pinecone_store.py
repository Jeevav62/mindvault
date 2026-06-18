"""Pinecone vector store — fallback when Qdrant unavailable.

Uses asyncio.to_thread since Pinecone's Python SDK is sync.
Index must be pre-created at console.pinecone.io with:
  - Dimensions: 1024 (match EMBEDDING_DIM)
  - Metric: cosine
  - Name: value of PINECONE_INDEX env var
"""
from __future__ import annotations

import asyncio
import uuid

from app.config import get_settings

from .base import Chunk, Hit, VectorStore, VectorStoreError


class PineconeStore(VectorStore):
    _index = None

    @property
    def name(self) -> str:
        return "pinecone"

    def _get_index(self):
        if self._index is None:
            try:
                from pinecone import Pinecone  # noqa: PLC0415
            except ImportError as exc:
                raise VectorStoreError(
                    "pinecone package not installed — run: pip install pinecone",
                    store=self.name,
                ) from exc
            s = get_settings()
            if not s.pinecone_api_key:
                raise VectorStoreError("PINECONE_API_KEY not configured", store=self.name)
            pc = Pinecone(api_key=s.pinecone_api_key)
            # Use host directly when set — skips descriptor lookup, faster init
            if s.pinecone_host:
                self._index = pc.Index(host=s.pinecone_host)
            else:
                self._index = pc.Index(s.pinecone_index)
        return self._index

    async def ensure_collection(self) -> None:
        # Index must be pre-created in Pinecone console (1024 dims, cosine).
        # This just verifies connectivity.
        try:
            index = self._get_index()
            await asyncio.to_thread(index.describe_index_stats)
        except VectorStoreError:
            raise
        except Exception as exc:
            raise VectorStoreError(str(exc), store=self.name) from exc

    async def upsert_chunks(
        self, user_id: str, chunks: list[Chunk], vectors: list[list[float]]
    ) -> int:
        records = [
            {
                "id": str(uuid.uuid4()),
                "values": vec,
                "metadata": {
                    "user_id": user_id,
                    "doc_id": ch.doc_id,
                    "chunk_index": ch.chunk_index,
                    "chunk_text": ch.text,
                    "source": ch.source,
                    "modality": ch.modality,
                },
            }
            for ch, vec in zip(chunks, vectors)
        ]
        try:
            index = self._get_index()
            # Pinecone recommends batches of 100
            for i in range(0, len(records), 100):
                batch = records[i : i + 100]
                await asyncio.to_thread(index.upsert, vectors=batch)
        except VectorStoreError:
            raise
        except Exception as exc:
            raise VectorStoreError(str(exc), store=self.name) from exc
        return len(records)

    async def search(
        self, user_id: str, query_vector: list[float], *, top_k: int = 5
    ) -> list[Hit]:
        try:
            index = self._get_index()
            res = await asyncio.to_thread(
                index.query,
                vector=query_vector,
                top_k=top_k,
                filter={"user_id": {"$eq": user_id}},
                include_metadata=True,
            )
        except VectorStoreError:
            raise
        except Exception as exc:
            raise VectorStoreError(str(exc), store=self.name) from exc

        hits: list[Hit] = []
        for match in res.get("matches", []):
            meta = match.get("metadata", {})
            hits.append(
                Hit(
                    text=meta.get("chunk_text", ""),
                    source=meta.get("source", ""),
                    doc_id=meta.get("doc_id", ""),
                    chunk_index=int(meta.get("chunk_index", 0)),
                    score=match.get("score", 0.0),
                )
            )
        return hits

    async def delete_doc(self, user_id: str, doc_id: str) -> None:
        try:
            index = self._get_index()
            await asyncio.to_thread(
                index.delete,
                filter={"user_id": {"$eq": user_id}, "doc_id": {"$eq": doc_id}},
            )
        except VectorStoreError:
            raise
        except Exception as exc:
            raise VectorStoreError(str(exc), store=self.name) from exc

    async def aclose(self) -> None:
        self._index = None
