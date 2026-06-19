from __future__ import annotations

import json as _json
import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.auth.dependencies import get_current_user
from app.auth.repository import UserRecord
from app.providers.base import ProviderError

from app.context import build_ambient_context

from .service import answer_question, answer_question_stream, generate_title

router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger(__name__)


class HistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=32_000)


class AmbientPayload(BaseModel):
    lat: float | None = None
    lon: float | None = None
    city: str | None = Field(default=None, max_length=120)
    country: str | None = Field(default=None, max_length=120)
    timestamp: str | None = Field(default=None, max_length=40)


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    top_k: int = Field(default=5, ge=1, le=20)
    mode: Literal["doc", "personal", "web"] = "doc"
    doc_ids: list[str] | None = None
    history: list[HistoryMessage] = Field(default_factory=list, max_length=20)
    attachment_text: str | None = Field(default=None, max_length=15_000)
    attachment_name: str | None = Field(default=None, max_length=256)
    image_data: str | None = None
    image_mime: str = "image/jpeg"
    ambient_payload: AmbientPayload | None = None


class CitationOut(BaseModel):
    source: str
    chunk_index: int
    doc_id: str
    score: float
    page_number: int | None = None
    chunk_text: str = ""
    url: str | None = None


class ChatResponse(BaseModel):
    answer: str
    citations: list[CitationOut]


def _top_citation(citations) -> list[CitationOut]:
    # Web citations: return all (already ranked by Tavily score)
    # Doc citations: return top-1 by score
    if citations and getattr(citations[0], "url", None):
        return [
            CitationOut(
                source=c.source, chunk_index=c.chunk_index, doc_id=c.doc_id,
                score=c.score, page_number=c.page_number, chunk_text=c.chunk_text,
                url=c.url,
            )
            for c in citations
        ]
    top = sorted(citations, key=lambda c: c.score, reverse=True)[:1]
    return [
        CitationOut(
            source=c.source, chunk_index=c.chunk_index, doc_id=c.doc_id,
            score=c.score, page_number=c.page_number, chunk_text=c.chunk_text,
            url=None,
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
            attachment_text=body.attachment_text, attachment_name=body.attachment_name,
            image_data=body.image_data, image_mime=body.image_mime,
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
            ambient_context: str | None = None
            if body.ambient_payload:
                p = body.ambient_payload
                ambient_context = await build_ambient_context(
                    lat=p.lat, lon=p.lon, city=p.city,
                    country=p.country, timestamp=p.timestamp,
                )
            async for event in answer_question_stream(
                user.id, body.question,
                top_k=body.top_k, mode=body.mode, doc_ids=body.doc_ids, history=history,
                attachment_text=body.attachment_text, attachment_name=body.attachment_name,
                image_data=body.image_data, image_mime=body.image_mime,
                ambient_context=ambient_context,
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


class TitleRequest(BaseModel):
    question: str = Field(max_length=500)
    answer: str = Field(max_length=1000)


@router.post("/title")
async def get_title(
    body: TitleRequest,
    user: UserRecord = Depends(get_current_user),
) -> dict:
    title = await generate_title(body.question, body.answer)
    return {"title": title}
