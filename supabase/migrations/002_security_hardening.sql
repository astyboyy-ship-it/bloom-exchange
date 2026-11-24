-- 002: lock the public schema down for Supabase's Data API (fixes Security Advisor "RLS disabled in public" and
-- "function search_path mutable").
--
-- Nothing reaches these tables through Supabase's REST/GraphQL API: the relay (apps/relay) and the Bloom AI app
-- (Prisma) both connect to Postgres directly as the table owner `postgres`, which owns every table here and has
-- BYPASSRLS, so neither is affected. The anon key is public by design, so until now anyone holding it could read,
-- insert, update, delete and TRUNCATE every table over REST (TRUNCATE also skips RLS and the append-only row
-- triggers). This migration:
--   1. enables row-level security on every table in public, with no policies: anon and authenticated see nothing;
--   2. revokes every table, sequence and function privilege from anon and authenticated in public, now and for
--      objects created later (Supabase grants them by default), which also closes TRUNCATE;
--   3. pins search_path on the two append-only trigger functions (they reference no tables).
-- The vector extension stays in public: see the note at the end.
--
-- Idempotent, one transaction, safe to re-run. Role-specific statements run only where Supabase's roles exist.

begin;

-- 1. RLS on every table in public (current and any created before this ran).
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('alter table public.%I enable row level security', t.relname);
  end loop;
end $$;

-- 2. No Data API access for anon or authenticated, now or later.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
      execute format('alter default privileges for role postgres in schema public revoke all on tables from %I', r);
      execute format('alter default privileges for role postgres in schema public revoke all on sequences from %I', r);
      execute format('alter default privileges for role postgres in schema public revoke all on functions from %I', r);
    end if;
  end loop;
end $$;

-- 3. Fixed search_path on the trigger functions (they use only TG_OP, NEW and OLD, so an empty path is safe).
alter function public.receipts_append_only() set search_path = '';
alter function public.room_events_append_only() set search_path = '';

commit;

-- Note on the vector extension (Security Advisor "extension in public"): it is left in public on purpose.
-- It belongs to the Bloom AI app's Prisma schema (DocumentChunk.embedding), whose datasource declares
-- `extensions = [vector]` without a schema. Moving it with `alter extension vector set schema extensions` would keep
-- the existing column working, but Prisma would then see drift between its schema and the database and try to
-- re-create the extension in public on the next migration. If the Prisma schema later declares
-- `vector(schema: "extensions")`, the move can be done together with that change. The relay does not use vector.
