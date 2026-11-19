import type { IncomingMessage, ServerResponse } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { createRelay } from "./app.ts";
import { ConfigError, relayConfig } from "./config.ts";

/**
 * The relay as one Vercel Node.js function (apps/relay/api/index.js, every path rewritten to it).
 *
 * On serverless there is no long-lived server to accept WebSocket upgrades, so clients stream over SSE (which polls
 * the shared store, so moves made in another invocation still arrive) or poll. SSE streams end before the function's
 * time limit (RELAY_STREAM_MS, default 50 s) and the SDK reconnects from its last event. Each instance keeps a small
 * Postgres pool (DATABASE_POOL_MAX, default 2): use Supabase's pooler for DATABASE_URL.
 *
 * A configuration error does not crash the function: every request gets a 503 that names what to fix.
 */
export function vercelHandler(env: NodeJS.ProcessEnv = process.env): (req: IncomingMessage, res: ServerResponse) => void {
  try {
    const host = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
    const config = relayConfig(env, { publicUrl: host ? `https://${host}` : "http://localhost:3000", streamMs: 50_000, poolMax: 2 });
    const relay = createRelay({ store: config.store, nonces: config.nonces, publicUrl: config.publicUrl, verifierUrl: config.verifierUrl, streamMs: config.streamMs, version: env.npm_package_version });
    return getRequestListener(relay.app.fetch);
  } catch (err) {
    const message = err instanceof ConfigError ? err.message : "The relay failed to start.";
    console.error(`[bloom-relay] ${message}`);
    const down = new Hono().all("*", (c) => c.json({ error: { code: "misconfigured", message } }, 503));
    return getRequestListener(down.fetch);
  }
}
