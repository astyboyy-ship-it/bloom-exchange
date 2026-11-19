import { createHash, createPublicKey, verify } from "node:crypto";
import { AUTH_HEADERS, AUTH_QUERY, authString, MAX_CLOCK_DRIFT_MS, NONCE_TTL_SECONDS, PUBKEY, SIGNATURE, UUID_V4 } from "@bloom-exchange/sdk";
import type { NonceStore } from "./nonce.ts";

/**
 * Verifies one request's Ed25519 authentication. Order matters:
 *   1. shape of all four values      2. clock drift (30 s)      3. the signature
 *   4. the nonce, claimed only once the signature is valid, so unsigned junk cannot burn a client's nonces.
 * The relay learns who is speaking and nothing else: it never holds or uses a private key.
 */
export type Authenticated = { ok: true; pubkey: string; timestamp: string; nonce: string; signature: string };
export type AuthFailure = { ok: false; status: 401 | 503; code: string; message: string };

const fail = (code: string, message: string, status: 401 | 503 = 401): AuthFailure => ({ ok: false, status, code, message });

export function ed25519Verify(pubkey: string, signature: string, message: string): boolean {
  try {
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: pubkey }, format: "jwk" });
    return verify(null, Buffer.from(message, "utf8"), key, Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
}

export const sha256Hex = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

export async function authenticate(input: {
  method: string;
  /** The signed target: path plus query (auth query parameters removed for WebSocket upgrades). */
  target: string;
  get: (name: string) => string | null | undefined;
  rawBody: Uint8Array;
  nonces: NonceStore;
  now: number;
}): Promise<Authenticated | AuthFailure> {
  const pubkey = input.get(AUTH_HEADERS.pubkey) ?? input.get(AUTH_QUERY.pubkey);
  const timestamp = input.get(AUTH_HEADERS.timestamp) ?? input.get(AUTH_QUERY.timestamp);
  const nonce = input.get(AUTH_HEADERS.nonce) ?? input.get(AUTH_QUERY.nonce);
  const signature = input.get(AUTH_HEADERS.signature) ?? input.get(AUTH_QUERY.signature);
  if (!pubkey || !timestamp || !nonce || !signature) return fail("auth_missing", "Signed request required: X-Bloom-Pubkey, X-Bloom-Timestamp, X-Bloom-Nonce, X-Bloom-Signature.");
  if (!PUBKEY.test(pubkey)) return fail("auth_pubkey", "X-Bloom-Pubkey must be a raw Ed25519 public key, base64url.");
  if (!/^\d{13}$/.test(timestamp)) return fail("auth_timestamp", "X-Bloom-Timestamp must be unix milliseconds.");
  if (Math.abs(input.now - Number(timestamp)) > MAX_CLOCK_DRIFT_MS) return fail("auth_clock_drift", "X-Bloom-Timestamp is more than 30 s from the relay's clock.");
  if (!UUID_V4.test(nonce)) return fail("auth_nonce", "X-Bloom-Nonce must be a lowercase UUIDv4.");
  if (!SIGNATURE.test(signature)) return fail("auth_signature", "X-Bloom-Signature must be an Ed25519 signature, base64url.");
  const message = authString(input.method, input.target, timestamp, nonce, sha256Hex(input.rawBody));
  if (!ed25519Verify(pubkey, signature, message)) return fail("auth_signature", "X-Bloom-Signature does not verify for this request.");
  let fresh: boolean;
  try {
    fresh = await input.nonces.claim(`bloom:relay:nonce:${pubkey}:${nonce}`, NONCE_TTL_SECONDS);
  } catch {
    return fail("auth_unavailable", "Replay protection is unavailable; try again.", 503);
  }
  if (!fresh) return fail("auth_replay", "This nonce was already used.");
  return { ok: true, pubkey, timestamp, nonce, signature };
}
