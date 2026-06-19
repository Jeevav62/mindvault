"""TTS endpoint: POST /tts — text → audio bytes."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.auth.dependencies import get_current_user
from app.providers import tts

router = APIRouter(prefix="/tts", tags=["tts"])


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


@router.post("")
async def synthesize_speech(req: TTSRequest, _=Depends(get_current_user)):
    audio_bytes, content_type = await tts.synthesize(req.text)
    return Response(content=audio_bytes, media_type=content_type)
