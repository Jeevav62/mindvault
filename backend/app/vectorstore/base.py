"""Base abstractions for vector stores."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class Chunk:
    text: str
    doc_id: str
    chunk_index: int
    source: str
    modality: str = "text"
    page_number: int | None = None


@dataclass
class Hit:
    text: str
    source: str
    doc_id: str
    chunk_index: int
    score: float
    page_number: int | None = None


class VectorStoreError(Exception):
    def __init__(self, message: str, store: str) -> None:
        super().__init__(message)
        self.store = store


class VectorStore(ABC):
    @property
    @abstractmethod
    def name(self) -> str: ...

    @abstractmethod
    async def ensure_collection(self) -> None: ...

    @abstractmethod
    async def upsert_chunks(
        self, user_id: str, chunks: list[Chunk], vectors: list[list[float]]
    ) -> int: ...

    @abstractmethod
    async def search(
        self, user_id: str, query_vector: list[float], *, top_k: int = 5, doc_ids: list[str] | None = None
    ) -> list[Hit]: ...

    @abstractmethod
    async def delete_doc(self, user_id: str, doc_id: str) -> None: ...

    @abstractmethod
    async def aclose(self) -> None: ...
