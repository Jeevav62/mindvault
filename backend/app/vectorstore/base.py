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


@dataclass
class Hit:
    text: str
    source: str
    doc_id: str
    chunk_index: int
    score: float


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
        self, user_id: str, query_vector: list[float], *, top_k: int = 5
    ) -> list[Hit]: ...

    @abstractmethod
    async def aclose(self) -> None: ...
