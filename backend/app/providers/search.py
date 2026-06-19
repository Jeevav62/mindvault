"""Tavily web search provider."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache

from app.providers._http import client as http_client

logger = logging.getLogger(__name__)


@dataclass
class WebResult:
    title: str
    url: str
    content: str
    score: float


class TavilySearchProvider:
    name = "tavily"
    _BASE = "https://api.tavily.com/search"

    def __init__(self, api_key: str, max_results: int = 5) -> None:
        self._key = api_key
        self._max = max_results

    async def search(self, query: str) -> list[WebResult]:
        c = http_client()
        resp = await c.post(
            self._BASE,
            json={
                "api_key": self._key,
                "query": query,
                "search_depth": "basic",
                "include_answer": False,
                "max_results": self._max,
            },
            timeout=15.0,
        )
        resp.raise_for_status()
        data = resp.json()
        results = []
        for r in data.get("results", []):
            results.append(WebResult(
                title=r.get("title", ""),
                url=r.get("url", ""),
                content=r.get("content", ""),
                score=float(r.get("score", 0.0)),
            ))
        return results


@lru_cache
def get_search_provider() -> TavilySearchProvider:
    from app.config import get_settings
    s = get_settings()
    return TavilySearchProvider(api_key=s.tavily_api_key)
