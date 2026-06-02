"""Grounded-prompt construction: budgeting, citations, refusal contract."""
from app.chat.prompt import SYSTEM_PROMPT, build_messages
from app.vectorstore import Hit


def _hit(i, text="passage text here"):
    return Hit(text=text, source="doc.pdf", doc_id="d1", chunk_index=i, score=0.9 - i * 0.01)


def test_system_prompt_enforces_refusal_and_citation():
    assert "couldn't find that in your documents" in SYSTEM_PROMPT
    assert "[source:" in SYSTEM_PROMPT


def test_messages_include_context_and_question():
    hits = [_hit(0), _hit(1)]
    messages, used = build_messages("What is X?", hits)
    assert messages[0].role == "system"
    assert "What is X?" in messages[1].content
    assert "doc.pdf #0" in messages[1].content
    assert len(used) == 2


def test_no_hits_marks_empty_context():
    messages, used = build_messages("anything?", [])
    assert "no relevant passages found" in messages[1].content
    assert used == []


def test_context_budget_truncates():
    big = "x" * 3000
    hits = [_hit(i, text=big) for i in range(10)]
    messages, used = build_messages("q", hits, max_context_chars=8000)
    # 8000 / ~3040 per block -> only first few kept, not all 10.
    assert 1 <= len(used) < 10
