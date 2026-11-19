import { canonicalize } from "./canonical.ts";
import { randomHex, sha256HexOf } from "./bytes.ts";

/**
 * Sealed mandates on the relay. A mandate (a buyer's ceiling, a seller's floor) never leaves the agent's edge:
 * the relay and the counterparty see only its salted SHA-256 commitment, which both parties sign into the receipt.
 * The edge clamps every offer it sends to its own mandate. Opening a commitment later (mandate + salt) lets anyone
 * check that the cleared price sat inside it, without the relay ever having seen the number.
 */
export type Mandate = {
  vertical: string;
  role: "buyer" | "seller";
  currency: string;
  /** Buyer: the highest acceptable price. Seller: the lowest. Atomic, like every price on the relay. */
  limitAtomic: string;
};
export type MandateOpening = { mandate: Mandate; salt: string };

const ATOMIC = /^(0|[1-9][0-9]{0,29})$/;
const SALT = /^[0-9a-f]{64}$/;

export async function commitmentOf(opening: MandateOpening): Promise<string> {
  return sha256HexOf(canonicalize({ domain: "bloom-mandate/1", mandate: opening.mandate, salt: opening.salt }));
}

/** Seals a mandate: returns the commitment to publish and the opening to keep private. */
export async function commitMandate(mandate: Mandate, salt = randomHex(32)): Promise<{ commitment: string; opening: MandateOpening }> {
  if (!ATOMIC.test(mandate.limitAtomic)) throw new Error("commitMandate: limitAtomic must be an atomic amount");
  if (!SALT.test(salt)) throw new Error("commitMandate: salt must be 32 bytes of lowercase hex");
  const opening = { mandate: { vertical: mandate.vertical, role: mandate.role, currency: mandate.currency, limitAtomic: mandate.limitAtomic }, salt };
  return { commitment: await commitmentOf(opening), opening };
}

/** Whether a price in a currency satisfies the mandate (buyer: at most the limit; seller: at least). */
export function withinMandate(priceAtomic: string, currency: string, mandate: Mandate): boolean {
  if (!ATOMIC.test(priceAtomic) || currency !== mandate.currency) return false;
  const p = BigInt(priceAtomic);
  const limit = BigInt(mandate.limitAtomic);
  return mandate.role === "buyer" ? p <= limit : p >= limit;
}

/** The edge's deterministic clamp: the nearest price to `priceAtomic` that the mandate allows. */
export function clampPrice(priceAtomic: string, mandate: Mandate): string {
  if (!ATOMIC.test(priceAtomic)) throw new Error("clampPrice: not an atomic amount");
  const p = BigInt(priceAtomic);
  const limit = BigInt(mandate.limitAtomic);
  return (mandate.role === "buyer" ? (p > limit ? limit : p) : p < limit ? limit : p).toString();
}
