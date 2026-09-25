-- Reproduz o mínimo do ambiente Supabase para aplicar as migrações e testar RLS
-- num Postgres local (sem Docker). NÃO é aplicado no Supabase real.

DO $$ BEGIN
  CREATE ROLE anon NOLOGIN NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE authenticated NOLOGIN NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT anon, authenticated, service_role TO postgres;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, extensions, public TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Mesma semântica do Supabase: lê o "sub" das claims do JWT da requisição.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), ''
  )::uuid
$$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

GRANT EXECUTE ON FUNCTION auth.uid(), auth.jwt() TO anon, authenticated, service_role;
