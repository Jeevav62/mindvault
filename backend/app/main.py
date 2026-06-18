"""FastAPI application entrypoint."""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import vectorstore
from app.auth.router import router as auth_router
from app.config import get_settings
from app.chat.router import router as chat_router
from app.ingest.router import router as ingest_router
from app.memory.router import router as memory_router
from app.providers import _http

logging.basicConfig(level=logging.INFO)

logger = logging.getLogger(__name__)


async def _warmup_memory() -> None:
    """Initialize the mem0 singleton at startup so first user request is instant."""
    try:
        from app.memory.service import _get_memory
        await asyncio.to_thread(_get_memory)
        logger.info("Mem0 warmup complete")
    except Exception as exc:
        logger.warning("Mem0 warmup failed (will retry on first request): %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm up mem0 in background — don't block server startup.
    asyncio.create_task(_warmup_memory())
    yield
    await _http.aclose()
    await vectorstore.aclose()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="Personal RAG Chatbot API", version="0.1.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health", tags=["meta"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(auth_router)
    app.include_router(ingest_router)
    app.include_router(chat_router)
    app.include_router(memory_router)
    return app


app = create_app()
