"""STT providers: Deepgram (primary) → Groq Whisper (fallback)."""
from __future__ import annotations

import logging
from functools import lru_cache

from app.providers._http import client as http_client

logger = logging.getLogger(__name__)


async def _deepgram_transcribe(audio: bytes, content_type: str, api_key: str) -> str:
    c = http_client()
    resp = await c.post(
        "https://api.deepgram.com/v1/listen",
        params={"model": "nova-2", "smart_format": "true"},
        headers={"Authorization": f"Token {api_key}", "Content-Type": content_type},
        content=audio,
        timeout=30.0,
    )
    resp.raise_for_status()
    data = resp.json()
    return data["results"]["channels"][0]["alternatives"][0]["transcript"]


async def _groq_transcribe(audio: bytes, content_type: str, api_key: str) -> str:
    c = http_client()
    ext = "webm" if "webm" in content_type else "wav" if "wav" in content_type else "m4a"
    resp = await c.post(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        headers={"Authorization": f"Bearer {api_key}"},
        files={"file": (f"audio.{ext}", audio, content_type)},
        data={"model": "whisper-large-v3", "response_format": "json"},
        timeout=60.0,
    )
    resp.raise_for_status()
    return resp.json()["text"]


async def transcribe(audio: bytes, content_type: str = "audio/webm") -> str:
    """Try Deepgram first, fall back to Groq Whisper."""
    from app.config import get_settings
    s = get_settings()

    if s.deepgram_api_key:
        try:
            return await _deepgram_transcribe(audio, content_type, s.deepgram_api_key)
        except Exception as exc:
            logger.warning("Deepgram STT failed, trying Groq Whisper: %s", exc)

    groq_keys = [k.strip() for k in s.groq_api_keys.split(",") if k.strip()]
    for key in groq_keys:
        try:
            return await _groq_transcribe(audio, content_type, key)
        except Exception as exc:
            logger.warning("Groq Whisper STT failed: %s", exc)

    raise RuntimeError("All STT providers failed")
