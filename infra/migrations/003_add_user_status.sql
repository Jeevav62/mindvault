-- Migration 003: add status column to users table
-- Supports pending → approved | rejected user approval workflow.
-- New signups default to 'pending'; admin approves via email link or UI.
-- Admin email (ADMIN_EMAIL env var) is auto-approved on signup.
-- Run: psql $DATABASE_URL -f infra/migrations/003_add_user_status.sql

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

-- Existing users (created before this migration) should be approved.
UPDATE users SET status = 'approved' WHERE status = 'pending';
