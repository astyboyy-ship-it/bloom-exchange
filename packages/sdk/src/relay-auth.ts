import type { AgentKey } from "./agent-key.ts";
import { sha256HexOf } from "./bytes.ts";

/**
 * Deterministic Ed25519 request authentication for the Bloom relay.
 *
 *   X-Bloom-Pubkey     raw Ed25519 public key, base64url
 *   X-Bloom-Timestamp  unix milliseconds; the relay rejects more than 30 s of drift
 *   X-Bloom-Nonce      UUIDv4; the relay rejects a nonce it has seen in the last 60 s
 *   X-Bloom-Signature  Ed25519 over
 *       METHOD "\n" PATH_WITH_QUERY "\n" TIMESTAMP "\n" NONCE "\n" SHA256_HEX(RAW_BODY)
 *
 * PATH_WITH_QUERY is the request target as sent (path plus `?query`, no scheme or host). A WebSocket upgrade, which
 * browsers cannot give custom headers, carries the same four values as `bloom_*` query parameters instead; they
 * are removed from the target before it is signed (see `signableTarget`).
 */
export const AUTH_HEADERS = { pubkey: "x-bloom-pubkey", timestamp: "x-bloom-timestamp", nonce: "x-bloom-nonce", signature: "x-bloom-signature" } as const;
export const AUTH_QUERY = { pubkey: "bloom_pubkey", timestamp: "bloom_ts", nonce: "bloom_nonce", signature: "bloom_sig" } as const;
export const MAX_CLOCK_DRIFT_MS = 30_000;
export const NONCE_TTL_SECONDS = 60;
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const EMPTY_BODY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export const authString = (method: string, pathWithQuery: string, timestamp: string, nonce: string, bodySha256Hex: string): string =>
  `${method.toUpperCase()}\n${pathWithQuery}\n${timestamp}\n${nonce}\n${bodySha256Hex}`;

/** The request target to sign: path and query of `url`, without any `bloom_*` auth parameters. */
export function signableTarget(url: URL): string {
  const q = new URLSearchParams();
  for (const [k, v] of url.searchParams) if (!(Object.values(AUTH_QUERY) as string[]).includes(k)) q.append(k, v);
  const s = q.toString();
  return `${url.pathname}${s ? `?${s}` : ""}`;
}

const uuidV4 = (): string => {
  // randomUUID is missing on non-secure origins in some browsers, so it is feature-checked at runtime.
  if (typeof (globalThis.crypto as { randomUUID?: unknown } | undefined)?.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

export type SignedAuth = { pubkey: string; timestamp: string; nonce: string; signature: string };

/** Signs one request. `body` is the exact string that will be sent ("" for none). */
export async function signRequest(key: AgentKey, method: string, pathWithQuery: string, body = "", now = Date.now()): Promise<SignedAuth> {
  const timestamp = String(now);
  const nonce = uuidV4();
  const signature = await key.sign(authString(method, pathWithQuery, timestamp, nonce, await sha256HexOf(body)));
  return { pubkey: key.publicKey, timestamp, nonce, signature };
}

export const authHeaders = (a: SignedAuth): Record<string, string> => ({
  [AUTH_HEADERS.pubkey]: a.pubkey,
  [AUTH_HEADERS.timestamp]: a.timestamp,
  [AUTH_HEADERS.nonce]: a.nonce,
  [AUTH_HEADERS.signature]: a.signature,
});

/** A signed WebSocket URL: the auth values travel as query parameters (browsers cannot set upgrade headers). */
export async function signedSocketUrl(key: AgentKey, url: URL, now = Date.now()): Promise<URL> {
  const a = await signRequest(key, "GET", signableTarget(url), "", now);
  const out = new URL(url);
  out.searchParams.set(AUTH_QUERY.pubkey, a.pubkey);
  out.searchParams.set(AUTH_QUERY.timestamp, a.timestamp);
  out.searchParams.set(AUTH_QUERY.nonce, a.nonce);
  out.searchParams.set(AUTH_QUERY.signature, a.signature);
  return out;
}
