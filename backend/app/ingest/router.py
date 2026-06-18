from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.auth.repository import UserRecord
from app.providers.base import ProviderError

from app.vectorstore import delete_doc

from .extract import UnsupportedFileType
from .service import EmptyDocument, ingest_document

router = APIRouter(prefix="/ingest", tags=["ingest"])

_MAX_BYTES = 25 * 1024 * 1024  # 25 MB cap for Phase 1


class IngestResponse(BaseModel):
    doc_id: str
    filename: str
    chunk_count: int


@router.post("", response_model=IngestResponse, status_code=status.HTTP_201_CREATED)
async def ingest(
    file: UploadFile = File(...),
    user: UserRecord = Depends(get_current_user),
) -> IngestResponse:
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "empty file")
    if len(data) > _MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "file too large")

    try:
        result = await ingest_document(user.id, file.filename or "upload", data)
    except UnsupportedFileType:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "unsupported file type"
        )
    except EmptyDocument:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "no extractable text")
    except ProviderError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"embedding failed: {exc}")

    return IngestResponse(
        doc_id=result.doc_id,
        filename=result.filename,
        chunk_count=result.chunk_count,
    )


@router.post("/extract-text")
async def extract_text_only(
    file: UploadFile = File(...),
    user: UserRecord = Depends(get_current_user),
) -> dict:
    """Extract text from a file without embedding/storing — for inline chat context."""
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "empty file")
    if len(data) > _MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "file too large")
    try:
        from .extract import extract_text
        text = extract_text(file.filename or "file", data)
    except UnsupportedFileType:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "unsupported file type")
    # Cap at 12 000 chars to stay within context window budgets
    return {"text": text[:12_000], "filename": file.filename or "file", "truncated": len(text) > 12_000}


@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    doc_id: str,
    user: UserRecord = Depends(get_current_user),
) -> None:
    try:
        await delete_doc(user.id, doc_id)
    except Exception as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"delete failed: {exc}")
