// Applies the relay's migrations without psql (Windows, CI), using the relay's own `pg` driver:
//   001_phase2_relay.sql        tables, indexes, append-only triggers; applied only to a database without them
//   002_security_hardening.sql  RLS on every public table, no Data API access for anon/authenticated, fixed
//                               search_path on the triggers; idempotent, so it is applied on every run
// A database that already has all five relay tables skips 001 and still gets 002; one with only some of them stops.
//
//   SUPABASE_DB_URL=postgres://... DATABASE_SSL_CA_FILE=./prod-ca-2021.crt node scripts/phase2-migrate.ts
//
// Each file runs as one simple-protocol query; it wraps itself in BEGIN ... COMMIT, so any error rolls the whole
// migration back. TLS is required and verified (against DATABASE_SSL_CA_FILE when given) for any non-local host;
// a local database (localhost, 127.0.0.1) connects without TLS. The URL is never printed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const url = process.env.SUPABASE_DB_URL?.trim();
const caFile = process.env.DATABASE_SSL_CA_FILE?.trim();
const dir = join(import.meta.dirname, "..", "supabase", "migrations");
const RELAY_TABLES = ["agents", "intents", "rooms", "room_events", "receipts"];

function fail(message: string): never {
  console.error(`  x ${message}`);
  process.exit(1);
}

if (!url) fail("SUPABASE_DB_URL is not set.");
let host: string;
try {
  host = new URL(url).hostname;
} catch {
  fail("SUPABASE_DB_URL is not a valid URL.");
}
if (/[?&]sslmode=/i.test(url)) fail("Remove sslmode from SUPABASE_DB_URL; TLS is configured here (verified, with DATABASE_SSL_CA_FILE).");
const local = /^(localhost|127\.0\.0\.1|\[?::1\]?)$/.test(host);
let ca: string | undefined;
if (caFile) {
  ca = readFileSync(caFile, "utf8");
  if (!ca.includes("-----BEGIN CERTIFICATE-----")) fail(`${caFile} is not a PEM certificate.`);
} else if (!local && /(^|\.)supabase\.com?$/.test(host)) {
  fail("Supabase signs its Postgres certificates with its own CA: set DATABASE_SSL_CA_FILE (Project Settings > Database > SSL configuration).");
}

const client = new pg.Client({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: true, ...(ca && { ca }) } });
try {
  await client.connect();
  console.log(`  connected to ${host}${local ? " (local, no TLS)" : " (TLS verified)"}`);
  const existing = (await client.query("select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1) order by 1", [RELAY_TABLES])).rows.map((r) => r.table_name as string);
  if (existing.length === RELAY_TABLES.length) console.log("  - 001_phase2_relay.sql already applied (all relay tables exist); skipped");
  else if (existing.length) fail(`partly migrated: only ${existing.join(", ")} exist. Nothing was changed; inspect the database before re-running.`);
  else {
    await client.query(readFileSync(join(dir, "001_phase2_relay.sql"), "utf8"));
    const triggers = await client.query("select tgname from pg_trigger where tgname in ('receipts_append_only','room_events_append_only') order by 1");
    console.log(`  ✓ applied 001_phase2_relay.sql: tables ${RELAY_TABLES.join(", ")}; triggers ${triggers.rows.map((r) => r.tgname).join(", ")}`);
  }

  await client.query(readFileSync(join(dir, "002_security_hardening.sql"), "utf8"));
  const noRls = (await client.query("select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity")).rows;
  const grants = (await client.query("select count(*)::int as n from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon','authenticated')")).rows[0].n as number;
  if (noRls.length || grants) fail(`002_security_hardening.sql did not take effect: ${noRls.length} table(s) without RLS, ${grants} anon/authenticated grant(s).`);
  console.log("  ✓ applied 002_security_hardening.sql: RLS on every public table, no anon/authenticated access, trigger search_path fixed");
} catch (err) {
  fail(`migration failed and was rolled back: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  await client.end().catch(() => undefined);
}
