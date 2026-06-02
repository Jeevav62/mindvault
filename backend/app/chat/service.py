"""Chat orchestration: embed query -> retrieve -> ground -> answer."""
from __future__ import annotations

from dataclasses import dataclass

from app.providers import get_embedding_router, get_llm_router
from app.vectorstore import Hit, search

from .prompt import build_messages


@dataclass
class Citation:
    source: str
    chunk_index: int
    doc_id: str
    score: float


@dataclass
class ChatAnswer:
    answer: str
    citations: list[Citation]


async def answer_question(user_id: str, question: str, *, top_k: int = 5) -> ChatAnswer:
    # 1. Embed the query (query input type matters for retrieval models).
    emb_router = get_embedding_router()
    qvec = (await emb_router.run(lambda p: p.embed([question], input_type="query")))[0]

    # 2. Retrieve this user's most relevant chunks.
    hits: list[Hit] = await search(user_id, qvec, top_k=top_k)

    # 3. Build grounded prompt (with context-budgeting) and answer.
    messages, used = build_messages(question, hits)
    llm_router = get_llm_router()
    text = await llm_router.run(lambda p: p.complete(messages))

    citations = [
        Citation(source=h.source, chunk_index=h.chunk_index, doc_id=h.doc_id, score=h.score)
        for h in used
    ]
    return ChatAnswer(answer=text, citations=citations)
