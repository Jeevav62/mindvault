-- Migration 002: grant service_role full access to all app tables
-- Required because RLS enabled tables need explicit grants even for service_role
-- Run: psql $DATABASE_URL -f infra/migrations/002_grant_service_role.sql

grant all on public.users         to service_role;
grant all on public.documents     to service_role;
grant all on public.chat_sessions to service_role;
grant all on public.messages      to service_role;
