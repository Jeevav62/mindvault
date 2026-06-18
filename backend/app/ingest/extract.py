"""Extract plain text from uploaded files (Phase 1: PDF + text)."""
from __future__ import annotations

import io


class UnsupportedFileType(Exception):
    pass


def extract_pages(filename: str, data: bytes) -> list[tuple[int, str]]:
    """Return list of (page_number, text) — 1-indexed. PDFs return one entry per page."""
    name = filename.lower()
    if name.endswith(".pdf"):
        return _extract_pdf_pages(data)
    if name.endswith((".txt", ".md", ".markdown")):
        return [(1, data.decode("utf-8", errors="replace"))]
    raise UnsupportedFileType(filename)


def extract_text(filename: str, data: bytes) -> str:
    pages = extract_pages(filename, data)
    return "\n\n".join(text for _, text in pages)


def _extract_pdf_pages(data: bytes) -> list[tuple[int, str]]:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    return [(i + 1, page.extract_text() or "") for i, page in enumerate(reader.pages)]
