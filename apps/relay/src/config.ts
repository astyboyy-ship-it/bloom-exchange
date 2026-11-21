import { MemoryNonceStore, UpstashNonceStore, type NonceStore } from "./nonce.ts";
import { MemoryStore } from "./store/memory.ts";
import { PostgresStore } from "./store/postgres.ts";
import type { Store } from "./store/types.ts";

/**
 * The relay's configuration from the environment, shared by the long-running server (main.ts) and the Vercel
 * function (vercel.ts). Throws a ConfigError naming what to fix; it never exits the process itself.
 *
 *   local / test   no configuration: memory store, in-process replay protection
 *   production     DATABASE_URL (Postgres/Supabase) and UPSTASH_REDIS_REST_URL + _TOKEN are required, so state and
 *                  replay protection are shared by every instance (and every serverless invocation)
 */
export const DEFAULT_RELAY_URL = "https://bloom-exchange-relay.vercel.app";
export const DEFAULT_VERIFIER_URL = "https://bloom-exchange-verify.vercel.app";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type RelayConfig = { store: Store; nonces: NonceStore; publicUrl: string; verifierUrl: string; streamMs: number; production: boolean };

export function relayConfig(env: NodeJS.ProcessEnv, defaults: { publicUrl: string; streamMs?: number; poolMax?: number }): RelayConfig {
  const production = env.NODE_ENV === "production";
  const db = env.DATABASE_URL?.trim();
  const redisUrl = env.UPSTASH_REDIS_REST_URL?.trim();
  const redisToken = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (production && !db) throw new ConfigError("DATABASE_URL is required in production (the memory store loses every receipt on restart).");
  if (production && !(redisUrl && redisToken)) throw new ConfigError("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required in production (replay protection must be shared).");
  if (Boolean(redisUrl) !== Boolean(redisToken)) throw new ConfigError("Set both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or neither.");

  // TLS to Postgres in production, always verified. DATABASE_SSL_CA holds the CA's PEM (literal newlines or \n).
  const ca = env.DATABASE_SSL_CA?.trim() ? env.DATABASE_SSL_CA.replace(/\\n/g, "\n") : undefined;
  if (ca && !ca.includes("-----BEGIN CERTIFICATE-----")) throw new ConfigError("DATABASE_SSL_CA must be a PEM certificate.");
  if (db && /[?&]sslmode=/i.test(db)) throw new ConfigError("Remove sslmode from DATABASE_URL; TLS is configured with DATABASE_SSL and DATABASE_SSL_CA.");
  const ssl = production && env.DATABASE_SSL !== "false" ? { ca } : false;
  const poolMax = Number(env.DATABASE_POOL_MAX ?? defaults.poolMax ?? 10);

  let publicUrl = env.RELAY_PUBLIC_URL?.trim() || defaults.publicUrl;
  try {
    const u = new URL(publicUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
    if (production && u.protocol !== "https:") throw new ConfigError("RELAY_PUBLIC_URL must be https in production.");
    publicUrl = u.origin;
  } catch (err) {
    throw err instanceof ConfigError ? err : new ConfigError(`RELAY_PUBLIC_URL must be an http(s) origin, e.g. ${DEFAULT_RELAY_URL}.`);
  }
  const streamMs = Math.min(Math.max(Number(env.RELAY_STREAM_MS ?? defaults.streamMs ?? 100_000) || 100_000, 5_000), 900_000);

  const store: Store = db ? new PostgresStore(db, { ssl, max: Number.isInteger(poolMax) && poolMax > 0 ? poolMax : 10 }) : new MemoryStore();
  const nonces: NonceStore = redisUrl && redisToken ? new UpstashNonceStore(redisUrl, redisToken) : new MemoryNonceStore();
  return { store, nonces, publicUrl, verifierUrl: env.VERIFIER_URL?.trim() || DEFAULT_VERIFIER_URL, streamMs, production };
}
