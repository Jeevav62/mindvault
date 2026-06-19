"""Fetch and extract clean text from a URL via Apify website-content-crawler."""
from __future__ import annotations

import logging

from app.providers._http import client as http_client

logger = logging.getLogger(__name__)

_ACTOR = "apify~website-content-crawler"
_RUN_SYNC = f"https://api.apify.com/v2/acts/{_ACTOR}/run-sync-get-dataset-items"


async def fetch_url_text(url: str) -> tuple[str, str]:
    """Crawl URL with Apify. Returns (title, markdown_text)."""
    from app.config import get_settings
    s = get_settings()
    if not s.apify_api_key:
        raise RuntimeError("APIFY_API_KEY not configured")

    c = http_client()
    resp = await c.post(
        _RUN_SYNC,
        params={"token": s.apify_api_key, "timeout": 90},
        json={
            "startUrls": [{"url": url}],
            "maxCrawlPages": 1,
            "crawlerType": "playwright:adaptive",
            "htmlTransformer": "readableText",
            "maxCrawlDepth": 0,
        },
        timeout=100.0,
    )
    resp.raise_for_status()
    items = resp.json()

    if not items:
        raise ValueError(f"Apify returned no content for {url}")

    item = items[0]
    title: str = item.get("title") or ""
    text: str = item.get("markdown") or item.get("text") or ""

    if not text.strip():
        raise ValueError(f"No extractable text found at {url}")

    # Format source name: "Title (domain.com)"
    from urllib.parse import urlparse
    domain = urlparse(url).netloc or url
    source_name = f"{title[:60]} ({domain})" if title else domain

    logger.info("Apify fetched %d chars from %s", len(text), url)
    return source_name, text
