"""TTS endpoints:
  POST /tts        — batch (text → full audio file, fallback)
  POST /tts/stream — streaming (text → raw PCM f32le chunks via Cartesia SSE)
"""
from __future__ import annotations

import base64
import json
import logging

import httpx
from fastapi import APIRouter, Depends
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from app.auth.dependencies import get_current_user
from app.providers import tts

router = APIRouter(prefix="/tts", tags=["tts"])
logger = logging.getLogger(__name__)

_CARTESIA_SSE = "https://api.cartesia.ai/tts/sse"
_CARTESIA_VERSION = "2024-06-10"
_SAMPLE_RATE = 22050  # lower = smaller chunks = lower latency


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


# ── Batch endpoint (fallback) ─────────────────────────────────────────────────

@router.post("")
async def synthesize_speech(req: TTSRequest, _=Depends(get_current_user)):
    audio_bytes, content_type = await tts.synthesize(req.text)
    return Response(content=audio_bytes, media_type=content_type)


# ── Streaming endpoint via Cartesia SSE → raw PCM f32le ──────────────────────

@router.post("/stream")
async def synthesize_stream(req: TTSRequest, _=Depends(get_current_user)):
    from app.config import get_settings
    s = get_settings()
    cartesia_keys = [k.strip() for k in s.cartesia_api_keys.split(",") if k.strip()]

    async def generate():
        for key in cartesia_keys:
            try:
                async with httpx.AsyncClient(timeout=60.0) as c:
                    async with c.stream(
                        "POST",
                        _CARTESIA_SSE,
                        headers={
                            "X-API-Key": key,
                            "Cartesia-Version": _CARTESIA_VERSION,
                            "Content-Type": "application/json",
                            "Accept": "text/event-stream",
                        },
                        json={
                            "model_id": "sonic-2",
                            "transcript": req.text,
                            "voice": {"mode": "id", "id": s.cartesia_voice_id},
                            "output_format": {
                                "container": "raw",
                                "encoding": "pcm_f32le",
                                "sample_rate": _SAMPLE_RATE,
                            },
                            "language": "en",
                        },
                    ) as resp:
                        if resp.status_code >= 400:
                            logger.warning("Cartesia SSE %d", resp.status_code)
                            continue
                        buf = ""
                        async for chunk in resp.aiter_text():
                            buf += chunk
                            while "\n\n" in buf:
                                event, buf = buf.split("\n\n", 1)
                                for line in event.splitlines():
                                    if line.startswith("data:"):
                                        try:
                                            data = json.loads(line[5:].strip())
                                            if data.get("type") == "chunk" and "data" in data:
                                                yield base64.b64decode(data["data"])
                                            elif data.get("type") == "done":
                                                return
                                        except Exception:
                                            pass
                        return
            except Exception as exc:
                logger.warning("Cartesia SSE stream failed: %s", exc)
                continue

        # Fallback: batch synthesis and stream in one shot
        logger.info("TTS stream fallback to batch")
        try:
            audio_bytes, _ = await tts.synthesize(req.text)
            yield audio_bytes
        except Exception as exc:
            logger.error("TTS batch fallback failed: %s", exc)

    return StreamingResponse(
        generate(),
        media_type="application/octet-stream",
        headers={"X-TTS-Sample-Rate": str(_SAMPLE_RATE), "X-TTS-Encoding": "pcm_f32le"},
    )
