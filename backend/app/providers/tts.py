"""TTS providers: Cartesia (primary) → Sarvam (fallback)."""
from __future__ import annotations

import base64
import logging

from app.providers._http import client as http_client

logger = logging.getLogger(__name__)

_CARTESIA_VERSION = "2024-06-10"


async def _cartesia_synthesize(text: str, api_key: str, voice_id: str) -> tuple[bytes, str]:
    """Returns (audio_bytes, content_type)."""
    c = http_client()
    resp = await c.post(
        "https://api.cartesia.ai/tts/bytes",
        headers={
            "X-API-Key": api_key,
            "Cartesia-Version": _CARTESIA_VERSION,
            "Content-Type": "application/json",
        },
        json={
            "model_id": "sonic-2",
            "transcript": text,
            "voice": {"mode": "id", "id": voice_id},
            "output_format": {"container": "mp3", "encoding": "mp3", "sample_rate": 44100},
            "language": "en",
        },
        timeout=30.0,
    )
    resp.raise_for_status()
    return resp.content, "audio/mpeg"


async def _sarvam_synthesize(text: str, api_key: str) -> tuple[bytes, str]:
    """Returns (audio_bytes, content_type). Sarvam returns base64 WAV."""
    c = http_client()
    resp = await c.post(
        "https://api.sarvam.ai/text-to-speech",
        headers={"api-subscription-key": api_key, "Content-Type": "application/json"},
        json={
            "inputs": [text[:500]],
            "target_language_code": "en-IN",
            "speaker": "meera",
            "speech_sample_rate": 22050,
            "enable_preprocessing": True,
            "model": "bulbul:v1",
        },
        timeout=30.0,
    )
    resp.raise_for_status()
    data = resp.json()
    audio_bytes = base64.b64decode(data["audios"][0])
    return audio_bytes, "audio/wav"


async def synthesize(text: str) -> tuple[bytes, str]:
    """Returns (audio_bytes, content_type). Tries Cartesia then Sarvam."""
    from app.config import get_settings
    s = get_settings()

    cartesia_keys = [k.strip() for k in s.cartesia_api_keys.split(",") if k.strip()]
    for key in cartesia_keys:
        try:
            return await _cartesia_synthesize(text, key, s.cartesia_voice_id)
        except Exception as exc:
            logger.warning("Cartesia TTS failed: %s", exc)

    sarvam_keys = [k.strip() for k in s.sarvam_api_keys.split(",") if k.strip()]
    for key in sarvam_keys:
        try:
            return await _sarvam_synthesize(text, key)
        except Exception as exc:
            logger.warning("Sarvam TTS failed: %s", exc)

    raise RuntimeError("All TTS providers failed")
