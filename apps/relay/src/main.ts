import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import { createRelay } from "./app.ts";
import { ConfigError, relayConfig } from "./config.ts";
import { PostgresStore } from "./store/postgres.ts";

/**
 * Starts the relay as a long-running server (local development, Docker, Fly). WebSocket streams, SSE and polling
 * all work here. For Vercel, see vercel.ts (no WebSocket; SSE and polling).
 */
const env = process.env;
const port = Number(env.PORT ?? 8787);
const host = env.HOST ?? (env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");

let config;
try {
  config = relayConfig(env, { publicUrl: `http://localhost:${port}` });
} catch (err) {
  console.error(`[bloom-relay] ${err instanceof ConfigError ? err.message : String(err)}`);
  process.exit(1);
}
const { store, nonces, publicUrl } = config;

const relay = createRelay({ store, nonces, publicUrl, verifierUrl: config.verifierUrl, streamMs: config.streamMs, version: env.npm_package_version });
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
