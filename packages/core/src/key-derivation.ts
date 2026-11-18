import { createHash, createHmac, createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";

/**
 * Deterministic exchange key derivation, shared by the server (crypto.ts) and the Sovereign node initializer
 * (scripts/sovereign-init.ts), so a node's root fingerprint printed at init time is exactly the one its Agent Card
 * publishes. No framework imports: it must run under plain Node.
 */
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export type DerivedKeys = { privateKey: KeyObject; publicX: string; kid: string; fingerprint: string; hmacKey: Buffer };

export function deriveExchangeKeys(secret: string): DerivedKeys {
  const seed = createHmac("sha256", secret).update("bloom-exchange/ed25519/v1").digest();
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: "der", type: "pkcs8" });
  const publicX = (createPublicKey(privateKey).export({ format: "jwk" }) as { x: string }).x;
  const digest = createHash("sha256").update(publicX, "utf8").digest("hex");
  return {
    privateKey,
    publicX,
    kid: `bxk-${digest.slice(0, 16)}`,
    // The full SHA-256 of the public key, grouped for reading aloud during an out-of-band key ceremony.
    fingerprint: digest.toUpperCase().match(/.{4}/g)!.join(":"),
    hmacKey: createHmac("sha256", secret).update("bloom-exchange/hmac-seal/v1").digest(),
  };
}
