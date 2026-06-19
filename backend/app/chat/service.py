"""Chat orchestration: embed query -> retrieve -> ground -> answer."""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from app import graph, memory
from app.providers import get_embedding_router, get_llm_router
from app.providers.base import ChatMessage
from app.providers.factory import get_vision_provider
from app.providers.search import get_search_provider
from app.vectorstore import Hit, search

from .prompt import build_messages, build_web_messages

logger = logging.getLogger(__name__)


@dataclass
class Citation:
    source: str
    chunk_index: int
    doc_id: str
    score: float
    page_number: int | None = None
    chunk_text: str = ""
    url: str | None = None  # set for web search citations


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

    if mode == "personal" and not attachment_text and not image_data:
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
    ambient_context: str | None = None,
):
    """Async generator yielding SSE event dicts: citations → tokens → done."""

    # ── Web search mode ────────────────────────────────────────────────────
    if mode == "web":
        searcher = get_search_provider()
        results = await searcher.search(question)
        web_citations = [
            Citation(
                source=r.title or r.url,
                chunk_index=i,
                doc_id="",
                score=r.score,
                url=r.url,
                chunk_text=r.content,
            )
            for i, r in enumerate(results)
        ]
        yield {"type": "citations", "citations": web_citations}
        msgs = build_web_messages(question, results, ambient_context=ambient_context)
        llm_router = get_llm_router()
        async for token in llm_router.run_stream(lambda p: p.complete_stream(msgs)):
            yield {"type": "token", "content": token}
        yield {"type": "done"}
        return

    # ── Standard RAG / personal ────────────────────────────────────────────
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

    graph_ctx = ""
    if mode == "personal":
        try:
            graph_ctx = await graph.query_context(user_id, question)
        except Exception:
            logger.warning("graph context failed; continuing without it")

    messages, used = build_messages(
        question, hits, memories=memories, graph_context=graph_ctx,
        ambient_context=ambient_context, mode=mode, history=history or [],
        attachment_text=attachment_text, attachment_name=attachment_name,
        image_data=image_data, image_mime=image_mime,
    )

    yield {"type": "citations", "citations": _hits_to_citations(used)}

    full_text: list[str] = []

    if image_data:
        vision = get_vision_provider()
        text = await vision.complete(messages, max_tokens=2048)
        full_text.append(text)
        for i in range(0, len(text), 8):
            yield {"type": "token", "content": text[i:i + 8]}
            await asyncio.sleep(0.01)
    else:
        llm_router = get_llm_router()
        async for token in llm_router.run_stream(lambda p: p.complete_stream(messages)):
            full_text.append(token)
            yield {"type": "token", "content": token}

    if mode == "personal" and not attachment_text and not image_data:
        answer_text = "".join(full_text)
        asyncio.create_task(_remember(user_id, question, answer_text))
        asyncio.create_task(_graph_remember(user_id, question))
    yield {"type": "done"}


async def _remember(user_id: str, question: str, answer: str) -> None:
    try:
        await memory.add_turn(user_id, question, answer)
    except Exception:
        logger.exception("memory write failed")


async def _graph_remember(user_id: str, question: str) -> None:
    try:
        await graph.add_turn(user_id, question)
    except Exception:
        logger.exception("graph write failed")


async def generate_title(question: str, answer: str) -> str:
    """Generate a short session title from first Q+A turn."""
    llm_router = get_llm_router()
    msgs = [
        ChatMessage(
            role="system",
            content=(
                "Generate a concise chat title (3-5 words, no quotes, no punctuation) "
                "that captures what this conversation is about."
            ),
        ),
        ChatMessage(
            role="user",
            content=f"User asked: {question[:200]}\nAssistant replied: {answer[:300]}",
        ),
    ]
    try:
        title = await llm_router.run(lambda p: p.complete(msgs))
        return title.strip().strip('"').strip("'")[:60]
    except Exception:
        return question[:48]
