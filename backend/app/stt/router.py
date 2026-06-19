"""STT endpoints:
  POST /stt        — batch fallback (blob → transcript)
  WS   /stt/ws     — streaming proxy to Deepgram (live transcript while speaking)
"""
from __future__ import annotations

import asyncio
import json
import logging

import websockets
from fastapi import APIRouter, Depends, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from app.auth.dependencies import get_current_user
from app.auth.security import TokenError, decode_token
from app.config import get_settings
from app.providers import stt

router = APIRouter(prefix="/stt", tags=["stt"])
logger = logging.getLogger(__name__)

_DG_BASE = (
    "wss://api.deepgram.com/v1/listen"
    "?model=nova-2&smart_format=true&interim_results=true&endpointing=300"
)


# ── Batch endpoint (fallback for browsers without MediaRecorder/WS) ───────────

@router.post("")
async def transcribe_audio(request: Request, _=Depends(get_current_user)):
    audio_bytes = await request.body()
    if not audio_bytes:
        return JSONResponse({"detail": "No audio data"}, status_code=400)
    content_type = request.headers.get("content-type", "audio/webm")
    text = await stt.transcribe(audio_bytes, content_type)
    return {"text": text.strip()}


# ── Streaming WebSocket proxy → Deepgram ──────────────────────────────────────

@router.websocket("/ws")
async def stt_stream_ws(websocket: WebSocket, token: str = Query(...)):
    try:
        decode_token(token, expected_type="access")
    except TokenError:
        await websocket.close(code=4001, reason="invalid token")
        return

    s = get_settings()
    if not s.deepgram_api_key:
        await websocket.accept()
        await websocket.send_json({"error": "STT not configured"})
        await websocket.close()
        return

    await websocket.accept()

    try:
        async with websockets.connect(
            _DG_BASE,
            additional_headers={"Authorization": f"Token {s.deepgram_api_key}"},
            open_timeout=10,
        ) as dg_ws:

            async def client_to_dg():
                try:
                    while True:
                        data = await websocket.receive()
                        if "bytes" in data:
                            await dg_ws.send(data["bytes"])
                        elif "text" in data:
                            # CloseStream signal from client
                            if data["text"] == "stop":
                                await dg_ws.send('{"type":"CloseStream"}')
                                break
                except (WebSocketDisconnect, Exception):
                    try:
                        await dg_ws.send('{"type":"CloseStream"}')
                    except Exception:
                        pass

            async def dg_to_client():
                try:
                    async for raw in dg_ws:
                        msg = json.loads(raw)
                        ch = msg.get("channel", {})
                        alts = ch.get("alternatives", [{}])
                        transcript = alts[0].get("transcript", "").strip()
                        is_final = msg.get("is_final", False)
                        speech_final = msg.get("speech_final", False)
                        if transcript:
                            await websocket.send_json({
                                "transcript": transcript,
                                "is_final": is_final or speech_final,
                            })
                except Exception:
                    pass

            async def keep_alive():
                try:
                    while True:
                        await asyncio.sleep(8)
                        await dg_ws.send('{"type":"KeepAlive"}')
                except Exception:
                    pass

            done, pending = await asyncio.wait(
                [
                    asyncio.create_task(client_to_dg()),
                    asyncio.create_task(dg_to_client()),
                    asyncio.create_task(keep_alive()),
                ],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for t in pending:
                t.cancel()

    except Exception as exc:
        logger.warning("STT WebSocket error: %s", exc)
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
