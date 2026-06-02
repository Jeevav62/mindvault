-- Supabase / Postgres schema for the RAG chatbot.
-- Run in the Supabase SQL editor. RLS is enabled so users can only touch their
-- own rows; the backend uses the service key (which bypasses RLS) for writes,
-- and we still scope every query by user_id in application code.

create extension if not exists pgcrypto;

-- ── Users ──────────────────────────────────────────────────────────────────
create table if not exists public.users (
    id            uuid primary key default gen_random_uuid(),
    email_enc     text not null,            -- AES-256-GCM field-encrypted email
    email_hash    text not null unique,     -- sha256(lower(email)) for lookup
    password_hash text not null,            -- Argon2id
    created_at    timestamptz not null default now()
);

-- ── Documents (metadata; encrypted blob lives on disk/S3) ───────────────────
create table if not exists public.documents (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid not null references public.users(id) on delete cascade,
    filename     text not null,
    modality     text not null default 'text',   -- text | audio | video (later)
    blob_path    text not null,                  -- path to encrypted blob
    chunk_count  int  not null default 0,
    created_at   timestamptz not null default now()
);
create index if not exists documents_user_idx on public.documents(user_id);

-- ── Chat sessions & messages ────────────────────────────────────────────────
create table if not exists public.chat_sessions (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references public.users(id) on delete cascade,
    title      text,
    created_at timestamptz not null default now()
);
create index if not exists chat_sessions_user_idx on public.chat_sessions(user_id);

create table if not exists public.messages (
    id           uuid primary key default gen_random_uuid(),
    session_id   uuid not null references public.chat_sessions(id) on delete cascade,
    user_id      uuid not null references public.users(id) on delete cascade,
    role         text not null check (role in ('user','assistant')),
    content      text not null,
    created_at   timestamptz not null default now()
);
create index if not exists messages_session_idx on public.messages(session_id);

-- ── Row Level Security ──────────────────────────────────────────────────────
alter table public.users         enable row level security;
alter table public.documents     enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.messages      enable row level security;

-- With Supabase Auth (auth.uid()) you'd add policies like:
--   create policy "own docs" on public.documents
--     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- This app issues its own JWT and accesses via the service key, so enforcement
-- is in application code; RLS here is defence-in-depth for any anon-key access.
