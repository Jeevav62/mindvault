"""Ingestion orchestration: encrypt+store -> extract -> chunk -> embed -> upsert."""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from app.providers import get_embedding_router
from app.storage import store_blob
from app.vectorstore import Chunk, ensure_collection, upsert_chunks

from .chunk import chunk_text
from .extract import extract_text


@dataclass
class IngestResult:
    doc_id: str
    filename: str
    blob_path: str
    chunk_count: int


class EmptyDocument(Exception):
    pass


async def ingest_document(user_id: str, filename: str, data: bytes) -> IngestResult:
    # 1. Encrypt + persist the original bytes at rest.
    blob_path = store_blob(user_id, data)

    # 2. Extract text (raises UnsupportedFileType for unknown formats).
    text = extract_text(filename, data)

    # 3. Chunk.
    pieces = chunk_text(text)
    if not pieces:
        raise EmptyDocument(filename)

    doc_id = str(uuid.uuid4())
    chunks = [
        Chunk(text=p, doc_id=doc_id, chunk_index=i, source=filename)
        for i, p in enumerate(pieces)
    ]

    # 4. Embed via the fallback router (document input type).
    router = get_embedding_router()
    vectors = await router.run(
        lambda p: p.embed([c.text for c in chunks], input_type="document")
    )

    # 5. Upsert into the per-user vector space.
    await ensure_collection()
    count = await upsert_chunks(user_id, chunks, vectors)

    return IngestResult(
        doc_id=doc_id, filename=filename, blob_path=blob_path, chunk_count=count
    )
