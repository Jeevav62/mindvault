"""FastAPI application entrypoint."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import vectorstore
from app.auth.router import router as auth_router
from app.config import get_settings
from app.chat.router import router as chat_router
from app.ingest.router import router as ingest_router
from app.providers import _http

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    # Clean up shared clients on shutdown.
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
    return app


app = create_app()
