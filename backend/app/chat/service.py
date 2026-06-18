"""Chat orchestration: embed query -> retrieve -> ground -> answer."""
from __future__ import annotations

from dataclasses import dataclass, field

import asyncio
import logging

from app import memory
from app.providers import get_embedding_router, get_llm_router
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


async def answer_question(
    user_id: str, question: str, *, top_k: int = 5, mode: str = "doc"
) -> ChatAnswer:
    emb_router = get_embedding_router()
    qvec = (await emb_router.run(lambda p: p.embed([question], input_type="query")))[0]

    hits: list[Hit] = [] if mode == "personal" else await search(user_id, qvec, top_k=top_k)

    try:
        memories = await memory.search(user_id, question, limit=5)
    except Exception:
        logger.exception("memory search failed; continuing without it")
        memories = []

    messages, used = build_messages(question, hits, memories=memories, mode=mode)
    llm_router = get_llm_router()
    text = await llm_router.run(lambda p: p.complete(messages))

    citations = [
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

    asyncio.create_task(_remember(user_id, question, text))
    return ChatAnswer(answer=text, citations=citations)


async def _remember(user_id: str, question: str, answer: str) -> None:
    try:
        await memory.add_turn(user_id, question, answer)
    except Exception:
        logger.exception("memory write failed")
