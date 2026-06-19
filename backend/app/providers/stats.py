"""In-memory provider usage stats. Resets on server restart — good enough for a portfolio demo."""
from __future__ import annotations

from collections import defaultdict

# {kind: {provider_name: {ok, fallback, error}}}
_data: dict[str, dict[str, dict[str, int]]] = defaultdict(
    lambda: defaultdict(lambda: {"ok": 0, "fallback": 0, "error": 0})
)


def record(kind: str, name: str, *, fallback: bool = False, error: bool = False) -> None:
    entry = _data[kind][name]
    if error:
        entry["error"] += 1
    else:
        entry["ok"] += 1
        if fallback:
            entry["fallback"] += 1


def snapshot() -> dict[str, dict[str, dict[str, int]]]:
    return {k: {n: dict(v) for n, v in providers.items()} for k, providers in _data.items()}
