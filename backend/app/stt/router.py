"""STT endpoint: POST /stt — raw audio → transcript text."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.auth.dependencies import get_current_user
from app.providers import stt

router = APIRouter(prefix="/stt", tags=["stt"])


@router.post("")
async def transcribe_audio(request: Request, _=Depends(get_current_user)):
    audio_bytes = await request.body()
    if not audio_bytes:
        return JSONResponse({"detail": "No audio data"}, status_code=400)
    content_type = request.headers.get("content-type", "audio/webm")
    text = await stt.transcribe(audio_bytes, content_type)
    return {"text": text.strip()}
