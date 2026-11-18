import { createHash, createHmac, randomBytes, sign, timingSafeEqual, type KeyObject } from "node:crypto";
import { signingInput } from "./canonical.ts";
import { deriveExchangeKeys } from "./key-derivation.ts";

/**
 * Exchange key material. One secret (BLOOM_EXCHANGE_SECRET, else the deployment's LICENSE_SIGNING_SECRET) derives
 * both the Ed25519 signing key, whose public half the Agent Card publishes so anyone can verify a certificate, and
 * the HMAC key behind the operator seal. Every instance derives the same keys, so a certificate minted on one
 * verifies on all. With no secret, development uses a fixed dev seed and production an ephemeral per-instance key
 * (flagged on the card), never a guessable one.
 */
export type KeyOrigin = "configured" | "development" | "ephemeral";
export type PublicJwk = { kty: "OKP"; crv: "Ed25519"; x: string; kid: string; alg: "EdDSA"; use: "sig" };

const DEV_SECRET = "bloom-exchange-development-secret-not-for-production";

type Keys = { origin: KeyOrigin; privateKey: KeyObject; jwk: PublicJwk; hmacKey: Buffer; fingerprint: string };
let cached: { secret: string | undefined; keys: Keys } | null = null;

function secret(): { value: string; origin: KeyOrigin } {
  const s = process.env.BLOOM_EXCHANGE_SECRET?.trim() || process.env.LICENSE_SIGNING_SECRET?.trim();
  if (s) return { value: s, origin: "configured" };
  if (process.env.NODE_ENV !== "production") return { value: DEV_SECRET, origin: "development" };
  return { value: randomBytes(32).toString("hex"), origin: "ephemeral" };
}

export function exchangeKeys(): Keys {
  const raw = process.env.BLOOM_EXCHANGE_SECRET?.trim() || process.env.LICENSE_SIGNING_SECRET?.trim();
  if (cached && cached.secret === raw) return cached.keys;
  const s = secret();
  const d = deriveExchangeKeys(s.value);
  const keys: Keys = { origin: s.origin, privateKey: d.privateKey, jwk: { kty: "OKP", crv: "Ed25519", x: d.publicX, kid: d.kid, alg: "EdDSA", use: "sig" }, hmacKey: d.hmacKey, fingerprint: d.fingerprint };
  cached = { secret: raw, keys };
  return keys;
}

export const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export function signDigest(digest: string): string {
  return sign(null, Buffer.from(signingInput(digest), "utf8"), exchangeKeys().privateKey).toString("base64url");
}

export function signString(s: string): string {
  return sign(null, Buffer.from(s, "utf8"), exchangeKeys().privateKey).toString("base64url");
}

export function sealDigest(digest: string): string {
  return createHmac("sha256", exchangeKeys().hmacKey).update(signingInput(digest)).digest("base64url");
}

export function verifySeal(digest: string, seal: string): boolean {
  const expected = Buffer.from(sealDigest(digest));
  const got = Buffer.from(seal);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** HMAC for outbound settlement webhooks (Stripe-style `t=…,v1=…`). */
export function webhookSignature(body: string, timestamp: number): string {
  const v1 = createHmac("sha256", exchangeKeys().hmacKey).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

export const randomId = (prefix: string, bytes = 16) => `${prefix}${randomBytes(bytes).toString("base64url")}`;
export const randomHex = (bytes = 32) => randomBytes(bytes).toString("hex");
