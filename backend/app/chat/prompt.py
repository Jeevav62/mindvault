"""Prompt construction for grounded RAG answers and personal chat mode."""
from __future__ import annotations

from app.providers.base import ChatMessage
from app.vectorstore import Hit

_DOC_SYSTEM = """You are a precise document assistant. Answer the user's \
question using ONLY the context passages provided below.

Rules:
- Use only facts found in the context. Do not use outside knowledge.
- If the answer is not in the context, reply exactly: "I couldn't find that in \
your documents." Do not guess.
- Cite the sources you used inline as [source: <name> #<chunk>].
- Be concise and direct. Prefer quoting/paraphrasing the context over padding.
- "Long-term memory" below is what you remember about this user from past \
sessions — use it to personalize tone/context, but never as a substitute for \
document context, and never let it override the refusal rule above.
"""

_PERSONAL_SYSTEM = """You are a helpful personal assistant with memory of past \
conversations. Use the long-term memory below to personalize your responses. \
Answer freely and conversationally — no document grounding required. \
Be friendly, concise, and helpful."""


def _budget_context(hits: list[Hit], max_chars: int) -> list[Hit]:
    kept: list[Hit] = []
    used = 0
    for h in hits:
        block = len(h.text) + 40
        if kept and used + block > max_chars:
            break
        kept.append(h)
        used += block
    return kept


def build_messages(
    question: str,
    hits: list[Hit],
    *,
    memories: list[str] | None = None,
    mode: str = "doc",
    history: list[tuple[str, str]] | None = None,
    max_context_chars: int = 8000,
    max_history_turns: int = 10,
) -> tuple[list[ChatMessage], list[Hit]]:
    """Return (messages, used_hits). Personal mode skips doc context."""
    memory_block = "\n".join(f"- {m}" for m in memories) if memories else "(none yet)"
    recent_history = (history or [])[-max_history_turns * 2:]

    if mode == "personal":
        system = _PERSONAL_SYSTEM + f"\n\nLong-term memory about this user:\n{memory_block}"
        msgs: list[ChatMessage] = [ChatMessage(role="system", content=system)]
        for role, content in recent_history:
            msgs.append(ChatMessage(role=role, content=content))
        msgs.append(ChatMessage(role="user", content=question))
        return msgs, []

    used = _budget_context(hits, max_context_chars)
    context = (
        "\n\n".join(f"[source: {h.source} #{h.chunk_index}]\n{h.text}" for h in used)
        if used
        else "(no relevant passages found)"
    )
    system = _DOC_SYSTEM + f"\n\nLong-term memory about this user:\n{memory_block}"
    msgs = [ChatMessage(role="system", content=system)]
    for role, content in recent_history:
        msgs.append(ChatMessage(role=role, content=content))
    user_content = f"Context passages:\n{context}\n\nQuestion: {question}"
    msgs.append(ChatMessage(role="user", content=user_content))
    return msgs, used
