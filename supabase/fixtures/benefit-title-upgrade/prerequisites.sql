-- Minimal local-cluster prerequisites for applying migrations 001 and 002 in an
-- isolated database. Supabase roles are cluster-global; this fixture creates only
-- database-local schemas, pgcrypto, and the two pre-001 tables referenced by 002.
create schema if not exists private;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists supabase_migrations;

create table public.profiles (
  id uuid primary key
);

create table public.rate_limit_rules (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  window_seconds integer not null,
  max_requests integer not null,
  is_enabled boolean not null default true,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(action,window_seconds)
);

create table supabase_migrations.schema_migrations (
  version text primary key,
  statements text[]
);
