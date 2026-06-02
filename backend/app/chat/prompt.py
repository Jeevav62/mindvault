"""Prompt construction for grounded RAG answers.

The system prompt enforces the core RAG contract: answer ONLY from retrieved
context, cite sources, and explicitly refuse when the answer isn't present —
this is what stops the model from hallucinating beyond the documents.
"""
from __future__ import annotations

from app.providers.base import ChatMessage
from app.vectorstore import Hit

SYSTEM_PROMPT = """You are a precise document assistant. Answer the user's \
question using ONLY the context passages provided below.

Rules:
- Use only facts found in the context. Do not use outside knowledge.
- If the answer is not in the context, reply exactly: "I couldn't find that in \
your documents." Do not guess.
- Cite the sources you used inline as [source: <name> #<chunk>].
- Be concise and direct. Prefer quoting/paraphrasing the context over padding.
"""


def _budget_context(hits: list[Hit], max_chars: int) -> list[Hit]:
    """Keep top hits (already score-ordered) until the char budget is spent."""
    kept: list[Hit] = []
    used = 0
    for h in hits:
        block = len(h.text) + 40  # rough overhead per labelled block
        if kept and used + block > max_chars:
            break
        kept.append(h)
        used += block
    return kept


def build_messages(
    question: str, hits: list[Hit], *, max_context_chars: int = 8000
) -> tuple[list[ChatMessage], list[Hit]]:
    """Return (messages, used_hits). used_hits drives the citation list."""
    used = _budget_context(hits, max_context_chars)
    if used:
        context = "\n\n".join(
            f"[source: {h.source} #{h.chunk_index}]\n{h.text}" for h in used
        )
    else:
        context = "(no relevant passages found)"

    user_content = f"Context passages:\n{context}\n\nQuestion: {question}"
    messages = [
        ChatMessage(role="system", content=SYSTEM_PROMPT),
        ChatMessage(role="user", content=user_content),
    ]
    return messages, used
