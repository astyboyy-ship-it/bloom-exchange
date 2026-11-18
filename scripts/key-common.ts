// Shared plumbing for access-key scripts: secret resolution, node:crypto signing, a round-trip self-check
// through the same verifier the node uses, and writing the key owner-only.
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ACCESS_KEY_PREFIX, DEV_SIGNING_SECRET, b64urlEncode, verifyAccessKey } from "../packages/core/src/licensing/codec.ts";
import type { BloomLicensePayload, UnsignedBloomPayload } from "../packages/core/src/licensing/types.ts";

/** Loads .env.local then .env (first one wins per variable). */
export function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    if (!existsSync(f)) continue;
    try {
      process.loadEnvFile(f);
    } catch {
      // A malformed env file shouldn't stop issuance; the secret can still come from the shell.
    }
  }
}

export function resolveSecret(): { value: string; dev: boolean } {
  const s = process.env.LICENSE_SIGNING_SECRET?.trim();
  if (s) return { value: s, dev: false };
  console.warn("\n  ! LICENSE_SIGNING_SECRET is not set: signing with the DEVELOPMENT secret.\n    The key verifies only on development nodes (or with BLOOM_DEV_LICENSES=true).\n");
  process.env.BLOOM_DEV_LICENSES = "true";
  return { value: DEV_SIGNING_SECRET, dev: true };
}

/** HMAC-SHA256 with node:crypto, byte-identical to the Web Crypto signer in codec.ts. */
export function signWithNodeCrypto(payload: UnsignedBloomPayload, secret: string): string {
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${ACCESS_KEY_PREFIX}${body}.${sig}`;
}

/** Signs, proves the key verifies through the node's verifier, and writes it to `file` (owner-only). */
export async function issueAndSave(payload: UnsignedBloomPayload, file: string, secret = resolveSecret()): Promise<{ key: string; verified: BloomLicensePayload; path: string; dev: boolean }> {
  const key = signWithNodeCrypto(payload, secret.value);
  const check = await verifyAccessKey(key);
  if (!check.ok) throw new Error(`Self-check failed: the signed key did not verify (${check.reason}).`);
  const path = resolve(file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${key}\n`, { encoding: "utf8", mode: 0o600 });
  return { key, verified: check.payload, path, dev: secret.dev };
}
