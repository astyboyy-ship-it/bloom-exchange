import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import { createRelay } from "./app.ts";
import { MemoryNonceStore, UpstashNonceStore, type NonceStore } from "./nonce.ts";
import { MemoryStore } from "./store/memory.ts";
import { PostgresStore } from "./store/postgres.ts";
import type { Store } from "./store/types.ts";

/**
 * Starts the relay.
 *   local / test   no configuration: memory store, in-process replay protection, http://localhost:8787
 *   production     DATABASE_URL (Postgres or Supabase) and UPSTASH_REDIS_REST_URL + _TOKEN are required, so state
 *                  and replay protection survive restarts and are shared by every instance.
 */
const env = process.env;
const production = env.NODE_ENV === "production";
const port = Number(env.PORT ?? 8787);
const host = env.HOST ?? (production ? "0.0.0.0" : "127.0.0.1");

function die(message: string): never {
  console.error(`[bloom-relay] ${message}`);
  process.exit(1);
}

const db = env.DATABASE_URL?.trim();
const redisUrl = env.UPSTASH_REDIS_REST_URL?.trim();
const redisToken = env.UPSTASH_REDIS_REST_TOKEN?.trim();
if (production && !db) die("DATABASE_URL is required in production (the memory store loses every receipt on restart).");
if (production && !(redisUrl && redisToken)) die("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required in production (replay protection must be shared).");
if (Boolean(redisUrl) !== Boolean(redisToken)) die("Set both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or neither.");

const store: Store = db ? new PostgresStore(db, { ssl: env.DATABASE_SSL !== "false" && production }) : new MemoryStore();
const nonces: NonceStore = redisUrl && redisToken ? new UpstashNonceStore(redisUrl, redisToken) : new MemoryNonceStore();

let publicUrl = env.RELAY_PUBLIC_URL?.trim() || `http://localhost:${port}`;
try {
  const u = new URL(publicUrl);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
  if (production && u.protocol !== "https:") die("RELAY_PUBLIC_URL must be https in production.");
  publicUrl = u.origin;
} catch {
  die("RELAY_PUBLIC_URL must be an http(s) origin, e.g. https://relay.bloomexchange.ai.");
}

const relay = createRelay({ store, nonces, publicUrl, verifierUrl: env.VERIFIER_URL?.trim() || "https://verify.bloomexchange.ai", version: env.npm_package_version });
const server = serve({ fetch: relay.app.fetch, port, hostname: host }, () => {
  console.error(`[bloom-relay] listening on http://${host}:${port} (public ${publicUrl}) · store ${store.kind} · nonces ${nonces.kind}`);
}) as Server;
relay.attach(server);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    relay.close();
    server.close(() => {
      if (store instanceof PostgresStore) void store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
