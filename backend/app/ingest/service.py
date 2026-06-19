"""Ingestion orchestration: encrypt+store -> extract -> chunk -> embed -> upsert."""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from app.providers import get_embedding_router
from app.storage import store_blob
from app.vectorstore import Chunk, ensure_collection, upsert_chunks

from .chunk import chunk_text
from .extract import extract_pages


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

    # 2. Extract text per page (raises UnsupportedFileType for unknown formats).
    pages = extract_pages(filename, data)

    # 3. Chunk per page, preserving page number on each chunk.
    doc_id = str(uuid.uuid4())
    chunks: list[Chunk] = []
    for page_num, page_text in pages:
        for piece in chunk_text(page_text):
            chunks.append(
                Chunk(
                    text=piece,
                    doc_id=doc_id,
                    chunk_index=len(chunks),
                    source=filename,
                    page_number=page_num,
                )
            )
    if not chunks:
        raise EmptyDocument(filename)

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


async def ingest_text(user_id: str, source_name: str, text: str) -> IngestResult:
    """Ingest pre-extracted text (e.g. from a URL) — skips blob storage."""
    doc_id = str(uuid.uuid4())
    chunks: list[Chunk] = []
    for piece in chunk_text(text):
        chunks.append(Chunk(
            text=piece,
            doc_id=doc_id,
            chunk_index=len(chunks),
            source=source_name,
            page_number=None,
        ))
    if not chunks:
        raise EmptyDocument(source_name)

    router = get_embedding_router()
    vectors = await router.run(
        lambda p: p.embed([c.text for c in chunks], input_type="document")
    )

    await ensure_collection()
    count = await upsert_chunks(user_id, chunks, vectors)

    return IngestResult(doc_id=doc_id, filename=source_name, blob_path="", chunk_count=count)
