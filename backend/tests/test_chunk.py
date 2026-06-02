"""Chunking: respects size, overlaps, handles empties."""
from app.ingest.chunk import chunk_text
from app.ingest.extract import UnsupportedFileType, extract_text


def test_empty_text_yields_no_chunks():
    assert chunk_text("") == []
    assert chunk_text("   \n  ") == []


def test_short_text_is_one_chunk():
    chunks = chunk_text("A single short sentence.")
    assert len(chunks) == 1


def test_long_text_splits_into_multiple():
    # ~60 sentences -> must exceed a 600-token window.
    text = " ".join(f"This is sentence number {i} about cats and dogs." for i in range(200))
    chunks = chunk_text(text, chunk_tokens=100, overlap_tokens=20)
    assert len(chunks) > 1
    # Every chunk non-empty.
    assert all(c.strip() for c in chunks)


def test_overlap_shares_content():
    text = " ".join(f"Sentence {i} here." for i in range(100))
    chunks = chunk_text(text, chunk_tokens=50, overlap_tokens=20)
    # Consecutive chunks should share at least one token (overlap tail).
    first_words = set(chunks[0].split())
    second_words = set(chunks[1].split())
    assert first_words & second_words


def test_extract_txt():
    assert "hello" in extract_text("note.txt", b"hello world")


def test_extract_unsupported():
    import pytest

    with pytest.raises(UnsupportedFileType):
        extract_text("image.png", b"\x89PNG")
