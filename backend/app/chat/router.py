from __future__ import annotations

import json as _json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.auth.dependencies import get_current_user
from app.auth.repository import UserRecord
from app.providers.base import ProviderError

from .service import answer_question, answer_question_stream

router = APIRouter(prefix="/chat", tags=["chat"])


class HistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    top_k: int = Field(default=5, ge=1, le=20)
    mode: Literal["doc", "personal"] = "doc"
    doc_ids: list[str] | None = None
    history: list[HistoryMessage] = Field(default_factory=list, max_length=20)


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


def _top_citation(citations) -> list[CitationOut]:
    top = sorted(citations, key=lambda c: c.score, reverse=True)[:1]
    return [
        CitationOut(
            source=c.source,
            chunk_index=c.chunk_index,
            doc_id=c.doc_id,
            score=c.score,
            page_number=c.page_number,
            chunk_text=c.chunk_text,
        )
        for c in top
    ]


@router.post("", response_model=ChatResponse)
async def chat(
    body: ChatRequest,
    user: UserRecord = Depends(get_current_user),
) -> ChatResponse:
    history = [(m.role, m.content) for m in body.history]
    try:
        result = await answer_question(
            user.id, body.question, top_k=body.top_k, mode=body.mode,
            doc_ids=body.doc_ids, history=history,
        )
    except ProviderError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"model/embedding failed: {exc}")

    return ChatResponse(answer=result.answer, citations=_top_citation(result.citations))


@router.post("/stream")
async def chat_stream(
    body: ChatRequest,
    user: UserRecord = Depends(get_current_user),
):
    async def event_gen():
        try:
            history = [(m.role, m.content) for m in body.history]
        async for event in answer_question_stream(
                user.id, body.question,
                top_k=body.top_k, mode=body.mode, doc_ids=body.doc_ids, history=history,
            ):
                if event["type"] == "citations":
                    top = _top_citation(event["citations"])
                    payload = [c.model_dump() for c in top]
                    yield f"data: {_json.dumps({'type': 'citations', 'citations': payload})}\n\n"
                elif event["type"] == "token":
                    yield f"data: {_json.dumps({'type': 'token', 'content': event['content']})}\n\n"
                elif event["type"] == "done":
                    yield f"data: {_json.dumps({'type': 'done'})}\n\n"
        except ProviderError as exc:
            yield f"data: {_json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
        except Exception as exc:
            logger.error("stream error: %s", exc)
            yield f"data: {_json.dumps({'type': 'error', 'message': 'Internal error'})}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


import logging
logger = logging.getLogger(__name__)
