"""Chat orchestration: embed query -> retrieve -> ground -> answer."""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from app import memory
from app.providers import get_embedding_router, get_llm_router
from app.providers.factory import get_vision_provider
from app.vectorstore import Hit, search

from .prompt import build_messages

logger = logging.getLogger(__name__)


@dataclass
class Citation:
    source: str
    chunk_index: int
    doc_id: str
    score: float
    page_number: int | None = None
    chunk_text: str = ""


@dataclass
class ChatAnswer:
    answer: str
    citations: list[Citation]


def _hits_to_citations(used: list[Hit]) -> list[Citation]:
    return [
        Citation(
            source=h.source,
            chunk_index=h.chunk_index,
            doc_id=h.doc_id,
            score=h.score,
            page_number=h.page_number,
            chunk_text=h.text,
        )
        for h in used
    ]


async def answer_question(
    user_id: str,
    question: str,
    *,
    top_k: int = 5,
    mode: str = "doc",
    doc_ids: list[str] | None = None,
    history: list[tuple[str, str]] | None = None,
    attachment_text: str | None = None,
    attachment_name: str | None = None,
    image_data: str | None = None,
    image_mime: str = "image/jpeg",
) -> ChatAnswer:
    emb_router = get_embedding_router()
    qvec = (await emb_router.run(lambda p: p.embed([question], input_type="query")))[0]

    hits: list[Hit] = (
        [] if mode == "personal" or image_data
        else await search(user_id, qvec, top_k=top_k, doc_ids=doc_ids)
    )

    try:
        memories = await memory.search(user_id, question, limit=5)
    except Exception:
        logger.exception("memory search failed; continuing without it")
        memories = []

    messages, used = build_messages(
        question, hits, memories=memories, mode=mode, history=history or [],
        attachment_text=attachment_text, attachment_name=attachment_name,
        image_data=image_data, image_mime=image_mime,
    )

    if image_data:
        vision = get_vision_provider()
        text = await vision.complete(messages, max_tokens=2048)
    else:
        llm_router = get_llm_router()
        text = await llm_router.run(lambda p: p.complete(messages))

    if mode == "personal":
        asyncio.create_task(_remember(user_id, question, text))
    return ChatAnswer(answer=text, citations=_hits_to_citations(used))


async def answer_question_stream(
    user_id: str,
    question: str,
    *,
    top_k: int = 5,
    mode: str = "doc",
    doc_ids: list[str] | None = None,
    history: list[tuple[str, str]] | None = None,
    attachment_text: str | None = None,
    attachment_name: str | None = None,
    image_data: str | None = None,
    image_mime: str = "image/jpeg",
):
    """Async generator yielding SSE event dicts: citations → tokens → done."""
    emb_router = get_embedding_router()
    qvec = (await emb_router.run(lambda p: p.embed([question], input_type="query")))[0]

    hits: list[Hit] = (
        [] if mode == "personal" or image_data
        else await search(user_id, qvec, top_k=top_k, doc_ids=doc_ids)
    )

    try:
        memories = await memory.search(user_id, question, limit=5)
    except Exception:
        logger.exception("memory search failed; continuing without it")
        memories = []

    messages, used = build_messages(
        question, hits, memories=memories, mode=mode, history=history or [],
        attachment_text=attachment_text, attachment_name=attachment_name,
        image_data=image_data, image_mime=image_mime,
    )

    yield {"type": "citations", "citations": _hits_to_citations(used)}

    full_text: list[str] = []

    if image_data:
        # Vision models don't stream well; complete() then emit as single token
        vision = get_vision_provider()
        text = await vision.complete(messages, max_tokens=2048)
        yield {"type": "token", "content": text}
        full_text.append(text)
    else:
        llm_router = get_llm_router()
        async for token in llm_router.run_stream(lambda p: p.complete_stream(messages)):
            full_text.append(token)
            yield {"type": "token", "content": token}

    if mode == "personal":
        asyncio.create_task(_remember(user_id, question, "".join(full_text)))
    yield {"type": "done"}


async def _remember(user_id: str, question: str, answer: str) -> None:
    try:
        await memory.add_turn(user_id, question, answer)
    except Exception:
        logger.exception("memory write failed")
