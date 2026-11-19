import { concat, fromB64url, fromHex, toB64url, utf8 } from "./bytes.ts";

/**
 * An agent's Ed25519 identity, held on the agent's edge. The relay only ever sees the public key and signatures.
 *
 * Keys are stored as a 32-byte seed (base64url). The public key is the raw 32-byte Ed25519 key, base64url: the
 * value of X-Bloom-Pubkey and of every `pubkey` field on the relay.
 */
const PKCS8_ED25519 = fromHex("302e020100300506032b657004220420");
export const PUBKEY = /^[A-Za-z0-9_-]{43}$/;
export const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;

export class AgentKey {
  /** Raw Ed25519 public key, base64url (43 characters). */
  readonly publicKey: string;
  private readonly key: CryptoKey;
  private readonly seed: string;

  private constructor(key: CryptoKey, publicKey: string, seed: string) {
    this.key = key;
    this.publicKey = publicKey;
    this.seed = seed;
  }

  static async generate(): Promise<AgentKey> {
    return AgentKey.fromSeed(toB64url(crypto.getRandomValues(new Uint8Array(32))));
  }

  /** Restores a key from its 32-byte seed (base64url), e.g. from BLOOM_AGENT_SEED. */
  static async fromSeed(seed: string): Promise<AgentKey> {
    const raw = fromB64url(seed.trim());
    if (raw.length !== 32) throw new Error("An agent seed is 32 bytes, base64url.");
    const key = await crypto.subtle.importKey("pkcs8", concat(PKCS8_ED25519, raw), { name: "Ed25519" }, true, ["sign"]);
    const jwk = await crypto.subtle.exportKey("jwk", key);
    if (!jwk.x) throw new Error("Could not derive the Ed25519 public key.");
    return new AgentKey(key, jwk.x, toB64url(raw));
  }

  /** The seed, for storing the identity. Treat it like a password. */
  exportSeed(): string {
    return this.seed;
  }

  /** Ed25519 signature over the message's UTF-8 bytes (or raw bytes), base64url (86 characters). */
  async sign(message: string | Uint8Array<ArrayBuffer>): Promise<string> {
    const sig = await crypto.subtle.sign({ name: "Ed25519" }, this.key, typeof message === "string" ? utf8(message) : message);
    return toB64url(new Uint8Array(sig));
  }
}

/** Verifies an Ed25519 signature against a raw public key (base64url). Never throws: malformed input is `false`. */
export async function verifyEd25519(publicKey: string, signature: string, message: string | Uint8Array<ArrayBuffer>): Promise<boolean> {
  if (!PUBKEY.test(publicKey) || !SIGNATURE.test(signature)) return false;
  try {
    const key = await crypto.subtle.importKey("raw", fromB64url(publicKey), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, fromB64url(signature), typeof message === "string" ? utf8(message) : message);
  } catch {
    return false;
  }
}
