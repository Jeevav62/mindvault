"""Token-aware chunking.

Splits text into ~`chunk_tokens` windows with `overlap_tokens` of overlap so a
fact spanning a boundary still appears whole in at least one chunk. Uses tiktoken
for token counts (model-agnostic cl100k_base) and falls back to whitespace word
counts if tiktoken is unavailable.
"""
from __future__ import annotations

import re

_DEFAULT_CHUNK = 600
_DEFAULT_OVERLAP = 80


def _encoder():
    try:
        import tiktoken

        return tiktoken.get_encoding("cl100k_base")
    except Exception:  # noqa: BLE001
        return None


# Split on paragraph/sentence boundaries first, then pack into token windows.
_SPLIT_RE = re.compile(r"(?<=[.!?])\s+|\n{2,}")


def chunk_text(
    text: str,
    *,
    chunk_tokens: int = _DEFAULT_CHUNK,
    overlap_tokens: int = _DEFAULT_OVERLAP,
) -> list[str]:
    text = text.strip()
    if not text:
        return []

    enc = _encoder()
    count = (lambda s: len(enc.encode(s))) if enc else (lambda s: len(s.split()))

    segments = [s.strip() for s in _SPLIT_RE.split(text) if s.strip()]
    chunks: list[str] = []
    current: list[str] = []
    current_tokens = 0

    for seg in segments:
        seg_tokens = count(seg)
        if current and current_tokens + seg_tokens > chunk_tokens:
            chunks.append(" ".join(current))
            # Carry over a tail for overlap.
            current, current_tokens = _overlap_tail(current, count, overlap_tokens)
        current.append(seg)
        current_tokens += seg_tokens

    if current:
        chunks.append(" ".join(current))
    return chunks


def _overlap_tail(segments: list[str], count, overlap_tokens: int) -> tuple[list[str], int]:
    tail: list[str] = []
    total = 0
    for seg in reversed(segments):
        t = count(seg)
        if total + t > overlap_tokens and tail:
            break
        tail.insert(0, seg)
        total += t
    return tail, total
