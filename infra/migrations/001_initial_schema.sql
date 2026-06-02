-- Migration 001: initial schema
-- Tables: users, documents, chat_sessions, messages
-- RLS enabled on all tables (service key bypasses; anon key blocked)
-- Run: psql $DATABASE_URL -f infra/migrations/001_initial_schema.sql

-- ── Extensions ─────────────────────────────────────────────────────────────
create extension if not exists pgcrypto;

-- ── Users ──────────────────────────────────────────────────────────────────
create table public.users (
    id            uuid primary key default gen_random_uuid(),
    email_enc     text not null,       -- AES-256-GCM encrypted email
    email_hash    text not null unique,-- sha256(lower(email)) for lookup
    password_hash text not null,       -- Argon2id
    created_at    timestamptz not null default now()
);

-- ── Documents ──────────────────────────────────────────────────────────────
create table public.documents (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid not null references public.users(id) on delete cascade,
    filename     text not null,
    modality     text not null default 'text', -- text | audio | video (Phase 3)
    blob_path    text not null,                -- path to encrypted blob on disk
    chunk_count  int  not null default 0,
    created_at   timestamptz not null default now()
);
create index documents_user_idx on public.documents(user_id);

-- ── Chat sessions ───────────────────────────────────────────────────────────
create table public.chat_sessions (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references public.users(id) on delete cascade,
    title      text,
    created_at timestamptz not null default now()
);
create index chat_sessions_user_idx on public.chat_sessions(user_id);

-- ── Messages ────────────────────────────────────────────────────────────────
create table public.messages (
    id         uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.chat_sessions(id) on delete cascade,
    user_id    uuid not null references public.users(id) on delete cascade,
    role       text not null check (role in ('user','assistant')),
    content    text not null,
    created_at timestamptz not null default now()
);
create index messages_session_idx on public.messages(session_id);
create index messages_user_idx    on public.messages(user_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.users         enable row level security;
alter table public.documents     enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.messages      enable row level security;
