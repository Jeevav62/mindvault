# RAG Chatbot — Personal Multimodal AI Assistant

A portfolio-grade personal RAG chatbot that stands out for hiring: secure login, upload documents (PDF, text — later audio/video), ask questions, get grounded cited answers. Built to demonstrate depth across AI engineering — not just calling an API.

## What makes this different

| Feature | What it shows |
|---------|---------------|
| AES-256-GCM encryption at rest | Crypto engineering — blobs + field-level encryption with AAD binding |
| Argon2id password hashing | Modern auth, not bcrypt |
| JWT access + refresh tokens | Stateless auth with proper expiry |
| Provider FallbackRouter | Resilience — auto fail-over across multiple providers AND multiple keys |
| Multi-key rotation | 5 Groq keys → 2 Cerebras → rate limit never blocks the user |
| Qdrant Cloud + Pinecone fallback | Dual vector store — if Qdrant goes down, Pinecone takes over |
| Token-aware chunking | tiktoken-based, 600 tokens with 80-token overlap |
| Grounded RAG prompt | Cites sources, refuses if answer not in documents |
| Mem0 memory (Phase 2) | Chatbot remembers the user across sessions |
| Multimodal ingestion (Phase 3) | PDF + audio/video via STT |
| TTS voice responses (Phase 4) | Spoken answers with mute toggle |
| Mic-mode login (Phase 4) | Voice-driven login — unique demo feature |

## Stack

**Backend:** FastAPI (Python 3.10+), Pydantic v2, uvicorn  
**Frontend:** Next.js 15, React 19, TypeScript, Tailwind CSS  
**Vector stores:** Qdrant Cloud (primary) → Pinecone (fallback)  
**Auth / users DB:** Supabase (Postgres + RLS)  
**Memory:** Mem0 OSS (Phase 2, backed by Qdrant + Postgres)

**Provider chains (all with automatic fallback):**
- LLM: Groq (5 keys) → Cerebras (2 keys)
- Embeddings: Voyage (2 keys) → Gemini (2 keys)
- STT: Deepgram → Cartesia (4 keys)
- TTS: Cartesia (4 keys) → Sarvam (7 keys) → Murf

## Architecture

```
Next.js 15                    FastAPI                        Data
──────────────────────        ──────────────────────         ──────────────────────
Auth (signup / login)   ──►   /auth  JWT + Argon2       ──►  Supabase Postgres
Chat UI + citations     ──►   /chat  RAG + memory       ──►  Qdrant Cloud / Pinecone
Upload (PDF, doc)       ──►   /ingest chunk+embed+AES   ──►  Encrypted blob store
Voice login (Phase 4)   ──►   /stt   STT FallbackRouter      Mem0 (Phase 2)
TTS responses (Phase 4) ──►   /tts   TTS FallbackRouter
```

**FallbackRouter pattern:** every provider modality (LLM, embeddings, STT, TTS, vector store) goes through a router that iterates slots in order. Each slot = one (provider, key) pair. On `QuotaError` or `ProviderUnavailable`, it advances to the next. `AllProvidersFailed` raised only if every slot exhausted.

**Crypto:** AES-256-GCM master key from env (KMS in Phase 5). `encrypt_blob(data, aad)` where AAD = user_id binds ciphertext to owner. Wire format: 12-byte nonce + ciphertext+tag. Email stored as `(encrypt_field(email), sha256(email))` — SHA-256 for deterministic lookup, ciphertext to keep plaintext off disk.

## Repo layout

```
backend/
  app/
    auth/          signup, login, JWT, Argon2, Supabase user repo
    crypto/        AES-256-GCM blob + field encryption
    providers/     LLM + embedding FallbackRouter (Groq, Cerebras, Voyage, Gemini)
    vectorstore/   VectorStoreRouter (Qdrant, Pinecone)
    ingest/        extract text → chunk → embed → upsert
    chat/          retrieve → grounded prompt → LLM answer
  tests/           29 unit tests
frontend/
  app/             Next.js app router
  lib/api.ts       typed API client
infra/
  docker-compose.yml        local Qdrant + Postgres
  migrations/               Supabase schema + RLS grants
```

## Quick start

**Requirements:** Python 3.10+, Node 18+, Docker (optional — only for local Qdrant)

```powershell
# 1. Backend
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
copy ..\env.example .env        # fill in keys (see .env.example)
python -m uvicorn app.main:app --reload

# 2. Frontend
cd ..\frontend
npm install
npm run dev
```

Open `http://localhost:3000` — sign up, upload a PDF, ask a question.  
API docs at `http://localhost:8000/docs`.

**Required secrets (generate once):**
```powershell
python -c "import secrets; print(secrets.token_urlsafe(64))"
python -c "import os,base64; print(base64.b64encode(os.urandom(32)).decode())"
```

**Required API keys** (all free tier):
- Groq: `console.groq.com`
- Voyage: `dash.voyageai.com`
- Gemini: `aistudio.google.com`
- Supabase: `supabase.com`
- Qdrant Cloud: `cloud.qdrant.io`
- Pinecone: `console.pinecone.io` — create index: 1024 dims, cosine

## Tests

```powershell
cd backend
python -m pytest -q
```

29 tests: provider fallback router, AES-256-GCM crypto, Argon2 auth flow, token-aware chunking, grounded prompt construction.

## Roadmap

- [x] Phase 1 — Auth + text RAG core (done)
- [ ] Phase 2 — Mem0 persistent user memory
- [ ] Phase 3 — Multimodal ingestion (audio / video via STT)
- [ ] Phase 4 — TTS voice responses + mic-mode login
- [ ] Phase 5 — Rate limiting, observability, cloud deploy
