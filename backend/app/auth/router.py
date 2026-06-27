from __future__ import annotations

import json as _json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status

import asyncio

from app.config import get_settings
from app.limiter import limiter
from app.email import send_approval_request_email
from app.auth.security import create_approval_token
from app.providers import get_llm_router, stt
from app.providers.base import ChatMessage

from .dependencies import get_current_user
from .repository import UserExists, UserRecord, get_user_repository
from .schemas import (
    LoginRequest,
    RefreshRequest,
    SignupRequest,
    TokenResponse,
    UserOut,
)
from .security import (
    TokenError,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)

_VOICE_PARSE_SYSTEM = (
    "You convert a SPOKEN dictation of login credentials into JSON. The user "
    "dictates an email and a password aloud, often spelling the password "
    "letter-by-letter with case and symbol instructions. Reconstruct each field "
    "exactly.\n\n"
    "Return ONLY a compact JSON object with keys \"email\" and \"password\". "
    "No markdown, no explanation.\n\n"
    "CASE INSTRUCTIONS (apply to the NEXT letter, then resume lowercase):\n"
    "- \"capital X\" / \"uppercase X\" / \"big X\" / \"X caps\" / \"caps X\" -> uppercase X\n"
    "- \"small X\" / \"lowercase X\" -> lowercase x\n"
    "- letters dictated alone (\"j\", \"k\") default to LOWERCASE unless a case "
    "instruction precedes them\n\n"
    "SYMBOL / NUMBER WORDS (convert when dictated): \"at\"->@, \"dot\"/\"point\"->., "
    "\"underscore\"->_, \"dash\"/\"hyphen\"/\"minus\"->-, \"plus\"->+, \"hash\"/\"pound\"->#, "
    "\"star\"/\"asterisk\"->*, \"exclamation\"/\"bang\"->!, \"dollar\"->$, "
    "\"percent\"->%, \"ampersand\"->&, number words (\"one\",\"two\") and \"number N\" -> digits.\n\n"
    "RULES:\n"
    "- Build the password by concatenating dictated tokens IN ORDER, no spaces.\n"
    "- Strip filler: \"my email is\", \"password is\", \"the\", \"then\", commas, periods "
    "used as sentence punctuation (not the literal word \"dot\").\n"
    "- Email: lowercase it, apply \"at\"->@ and \"dot\"->., remove inner spaces.\n"
    "- If a field is absent, use an empty string.\n\n"
    "EXAMPLES:\n"
    "Transcript: \"my email is alice at gmail dot com password capital J small k 4 2 dollar\"\n"
    "JSON: {\"email\":\"alice@gmail.com\",\"password\":\"Jk42$\"}\n"
    "Transcript: \"bob at yahoo dot com, password is hunter caps t 7\"\n"
    "JSON: {\"email\":\"bob@yahoo.com\",\"password\":\"hunterT7\"}"
)


async def _parse_spoken_credentials(transcript: str) -> dict[str, str]:
    """LLM-parse a spoken transcript into {email, password} for form prefill."""
    msgs = [
        ChatMessage(role="system", content=_VOICE_PARSE_SYSTEM),
        ChatMessage(role="user", content=f"Transcript: {transcript}\n\nJSON:"),
    ]
    raw = await get_llm_router().run(lambda p: p.complete(msgs))
    raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        data = _json.loads(raw)
    except (ValueError, TypeError):
        return {"email": "", "password": ""}
    return {
        "email": str(data.get("email", "")).strip(),
        "password": str(data.get("password", "")).strip(),
    }


def _tokens(user_id: str) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(user_id),
        refresh_token=create_refresh_token(user_id),
    )


def _is_admin(email: str) -> bool:
    s = get_settings()
    return bool(s.admin_email) and email.lower() == s.admin_email.lower()


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
async def signup(request: Request, body: SignupRequest) -> TokenResponse:
    repo = get_user_repository()
    # Admin email auto-approved; gate everyone else unless approval is disabled.
    auto = _is_admin(str(body.email)) or not get_settings().require_approval
    initial_status = "approved" if auto else "pending"
    try:
        user = await repo.create(str(body.email), hash_password(body.password), status=initial_status)
    except UserExists:
        raise HTTPException(status.HTTP_409_CONFLICT, "email already registered")
    if user.status == "pending":
        # Fire approval email to admin in background (don't block signup response)
        s = get_settings()
        if s.admin_email:
            approval_token = create_approval_token(user.id)
            approve_url = f"{s.app_base_url}/admin/approve-link?token={approval_token}"
            asyncio.create_task(
                send_approval_request_email(
                    new_user_email=str(body.email),
                    approve_url=approve_url,
                )
            )
        raise HTTPException(status.HTTP_403_FORBIDDEN, "pending_approval")
    return _tokens(user.id)


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
async def login(request: Request, body: LoginRequest) -> TokenResponse:
    repo = get_user_repository()
    user = await repo.get_by_email(str(body.email))
    # Always verify to avoid timing-based email enumeration
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials")

    # Admin email: auto-approve if somehow still pending (e.g. after DB migration)
    if user.status == "pending" and _is_admin(user.email):
        await repo.set_status(user.id, "approved")
        user.status = "approved"

    if user.status == "pending":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "pending_approval")
    if user.status == "rejected":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "access_denied")

    return _tokens(user.id)


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("30/minute")
async def refresh(request: Request, body: RefreshRequest) -> TokenResponse:
    try:
        payload = decode_token(body.refresh_token, expected_type="refresh")
    except TokenError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc))
    return _tokens(payload["sub"])


@router.post("/voice")
@limiter.limit("10/minute")
async def voice_credentials(request: Request) -> dict:
    """Mic-mode login: spoken audio -> STT transcript -> parsed {email, password}.

    Public (pre-auth). The parsed fields are returned to the client to PREFILL
    the form — the user reviews and submits through the normal login/signup
    flow, so voice never bypasses password verification.
    """
    audio = await request.body()
    if not audio:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "no audio data")
    content_type = request.headers.get("content-type", "audio/webm")
    try:
        # stt.transcribe raises bare RuntimeError when all providers fail
        # (e.g. transient DNS/network), so catch broadly here.
        transcript = (await stt.transcribe(audio, content_type)).strip()
    except Exception as exc:
        logger.warning("voice STT failed: %s", exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "transcription unavailable, try again")
    if not transcript:
        return {"transcript": "", "email": "", "password": ""}
    try:
        fields = await _parse_spoken_credentials(transcript)
    except Exception as exc:
        logger.warning("voice credential parse failed: %s", exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "could not parse credentials, try again")
    return {"transcript": transcript, **fields}


@router.get("/me", response_model=UserOut)
async def me(user: UserRecord = Depends(get_current_user)) -> UserOut:
    return UserOut(id=user.id, email=user.email)
