from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.auth.dependencies import get_current_user
from app.auth.repository import UserRecord
from app.providers.base import ProviderError

from .service import answer_question

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    top_k: int = Field(default=5, ge=1, le=20)
    mode: Literal["doc", "personal"] = "doc"


class CitationOut(BaseModel):
    source: str
    chunk_index: int
    doc_id: str
    score: float
    page_number: int | None = None
    chunk_text: str = ""


class ChatResponse(BaseModel):
    answer: str
    citations: list[CitationOut]


@router.post("", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    user: UserRecord = Depends(get_current_user),
) -> ChatResponse:
    try:
        result = await answer_question(
            user.id, body.question, top_k=body.top_k, mode=body.mode
        )
    except ProviderError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"model/embedding failed: {exc}")

    top_citations = sorted(result.citations, key=lambda c: c.score, reverse=True)[:1]

    return ChatResponse(
        answer=result.answer,
        citations=[
            CitationOut(
                source=c.source,
                chunk_index=c.chunk_index,
                doc_id=c.doc_id,
                score=c.score,
                page_number=c.page_number,
                chunk_text=c.chunk_text,
            )
            for c in top_citations
        ],
    )
