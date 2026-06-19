"""FastAPI application entrypoint."""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import graph, vectorstore
from app.auth.router import router as auth_router
from app.config import get_settings
from app.chat.router import router as chat_router
from app.graph.client import aclose as graph_aclose
from app.ingest.router import router as ingest_router
from app.memory.router import router as memory_router
from app.stt.router import router as stt_router
from app.tts.router import router as tts_router
from app.usage.router import router as usage_router
from app.providers import _http

logging.basicConfig(level=logging.INFO)

logger = logging.getLogger(__name__)


async def _warmup_memory() -> None:
    """Ensure the memory Qdrant collection exists at startup."""
    try:
        from app.memory.service import warmup
        await warmup()
    except Exception as exc:
        logger.warning("Memory warmup failed (will retry on first request): %s", exc)


async def _warmup_graph() -> None:
    """Ensure Neo4j schema constraints exist at startup."""
    try:
        await graph.warmup()
    except Exception as exc:
        logger.warning("Graph warmup failed (will retry on first request): %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(_warmup_memory())
    asyncio.create_task(_warmup_graph())
    yield
    await _http.aclose()
    await vectorstore.aclose()
    await graph_aclose()


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
    app.include_router(stt_router)
    app.include_router(tts_router)
    app.include_router(usage_router)
    return app


app = create_app()
