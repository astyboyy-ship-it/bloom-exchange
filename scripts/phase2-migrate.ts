// Applies supabase/migrations/001_phase2_relay.sql without psql (Windows, CI), using the relay's own `pg` driver.
//
//   SUPABASE_DB_URL=postgres://... DATABASE_SSL_CA_FILE=./prod-ca-2021.crt node scripts/phase2-migrate.ts
//
// The file runs as one simple-protocol query; it wraps itself in BEGIN ... COMMIT, so any error rolls the whole
// migration back. TLS is required and verified (against DATABASE_SSL_CA_FILE when given) for any non-local host;
// a local database (localhost, 127.0.0.1) connects without TLS. The URL is never printed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const url = process.env.SUPABASE_DB_URL?.trim();
const caFile = process.env.DATABASE_SSL_CA_FILE?.trim();
const file = join(import.meta.dirname, "..", "supabase", "migrations", "001_phase2_relay.sql");

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
} else if (!local && host.endsWith("supabase.co")) {
  fail("Supabase signs its Postgres certificates with its own CA: set DATABASE_SSL_CA_FILE (Project Settings > Database > SSL configuration).");
}

const client = new pg.Client({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: true, ...(ca && { ca }) } });
try {
  await client.connect();
  console.log(`  connected to ${host}${local ? " (local, no TLS)" : " (TLS verified)"}`);
  const existing = await client.query("select table_name from information_schema.tables where table_schema = 'public' and table_name in ('agents','intents','rooms','room_events','receipts')");
  if (existing.rows.length) fail(`already migrated: ${existing.rows.map((r) => r.table_name).sort().join(", ")} exist. Nothing was changed.`);
  await client.query(readFileSync(file, "utf8"));
  const tables = await client.query("select table_name from information_schema.tables where table_schema = 'public' and table_name in ('agents','intents','rooms','room_events','receipts') order by 1");
  const triggers = await client.query("select tgname from pg_trigger where tgname in ('receipts_append_only','room_events_append_only') order by 1");
  console.log(`  ✓ applied 001_phase2_relay.sql: tables ${tables.rows.map((r) => r.table_name).join(", ")}; triggers ${triggers.rows.map((r) => r.tgname).join(", ")}`);
} catch (err) {
  fail(`migration failed and was rolled back: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  await client.end().catch(() => undefined);
}
