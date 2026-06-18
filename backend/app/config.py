"""Central application settings, loaded from environment / .env.

Provider order strings (e.g. "groq,cerebras") are parsed into ordered lists so
the FallbackRouter can try each provider in turn.
"""
from __future__ import annotations

from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _csv(value: str | list[str]) -> list[str]:
    if isinstance(value, list):
        return value
    return [v.strip() for v in value.split(",") if v.strip()]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # App
    app_env: str = "development"
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])

    # Security / crypto
    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    jwt_access_ttl_min: int = 30
    jwt_refresh_ttl_days: int = 7
    crypto_master_key: str = ""  # base64-encoded 32 bytes

    # Postgres / Supabase
    database_url: str = ""
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_key: str = ""

    # Vector stores
    vector_store_order: list[str] = Field(default_factory=lambda: ["qdrant", "pinecone"])
    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: str = ""
    qdrant_collection: str = "rag_documents"
    pinecone_api_key: str = ""
    pinecone_index: str = "rag-documents"
    pinecone_host: str = ""
    mem0_collection: str = "rag_memories"

    # Storage
    blob_store_dir: str = "./data/blobs"

    # LLM
    llm_provider_order: list[str] = Field(default_factory=lambda: ["groq", "cerebras"])
    groq_api_keys: str = ""   # CSV — split with _csv() at use site
    groq_model: str = "llama-3.3-70b-versatile"
    # CSV of Groq fallback models tried in order after groq_model hits TPM.
    # Each model has its own TPM bucket, so rotation avoids rate-limit stalls.
    groq_fallback_models: str = "llama-3.1-8b-instant"
    groq_vision_model: str = "meta-llama/llama-4-scout-17b-16e-instruct"
    cerebras_api_keys: str = ""
    cerebras_model: str = "llama-3.3-70b"

    # Embeddings
    embedding_provider_order: list[str] = Field(
        default_factory=lambda: ["voyage", "gemini"]
    )
    embedding_dim: int = 1024
    voyage_api_keys: str = ""
    voyage_model: str = "voyage-3"
    gemini_api_keys: str = ""
    gemini_embed_model: str = "gemini-embedding-001"

    # STT / TTS (used in later phases)
    stt_provider_order: list[str] = Field(
        default_factory=lambda: ["deepgram", "cartesia"]
    )
    deepgram_api_key: str = ""
    cartesia_api_keys: str = ""
    tts_provider_order: list[str] = Field(
        default_factory=lambda: ["cartesia", "sarvam", "murf"]
    )
    sarvam_api_keys: str = ""
    murf_api_key: str = ""

    @field_validator(
        "cors_origins",
        "vector_store_order",
        "llm_provider_order",
        "embedding_provider_order",
        "stt_provider_order",
        "tts_provider_order",
        mode="before",
    )
    @classmethod
    def _split_csv(cls, v):
        if isinstance(v, str):
            return _csv(v)
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()
