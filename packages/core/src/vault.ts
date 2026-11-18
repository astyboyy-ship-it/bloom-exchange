import { canonicalize } from "./canonical";
import { seeded } from "./platform/util";
import { resourceFloorUsd } from "./resources";
import { effectiveCeiling, effectiveFloor, type Allocation, type CounterpartyMandate, type InitiatorMandate } from "./types";

/**
 * The zero-leakage double-blind vault. Each enclave seals both parties' mandates server-side and exposes them only
 * through narrow, side-specific accessors:
 *  - `initiatorBrief` is the ONLY input the provider's engines (and their LLM prompts) receive. Its type has no
 *    counterparty field, so the counterparty's limits cannot reach a prompt by construction.
 *  - `counterpartyPolicy` is the neutral proxy's view of the client's own limits.
 *  - `commitments` are salted SHA-256 hiding commitments printed on the certificate: they bind each party to the
 *    mandate it deposited without revealing it, and can be opened later by revealing mandate + salt.
 * Reserves sit a seeded guard band inside each limit, so no offer ever lands exactly on a private number.
 */

export type SealedVault = {
  initiator: InitiatorMandate;
  counterparty: CounterpartyMandate;
  salts: { initiator: string; counterparty: string };
  /** Fractions: the seller's reserve sits this far above its floor, the buyer's this far below its ceiling. */
  guardBand: { initiator: number; counterparty: number };
  /** Sovereign's resource allocation for this enclave (null when no resource dimensions were requested). */
  allocation: Allocation | null;
};

export type InitiatorBrief = {
  anchorPriceUsd: number;
  reservePriceUsd: number;
  maxNetDays: number;
  maxSlaTier: InitiatorMandate["maxSlaTier"];
  autoSettleCeilingUsd: number;
};

export type CounterpartyPolicy = {
  reservePriceUsd: number;
  openingPriceUsd: number;
  requiredSlaTier: CounterpartyMandate["requiredSlaTier"];
  targetNetDays: number;
};

export function sealVault(seed: string, initiator: InitiatorMandate, counterparty: CounterpartyMandate, salts: { initiator: string; counterparty: string }, allocation: Allocation | null = null): SealedVault {
  const rng = seeded(`guard:${seed}`);
  return {
    initiator,
    counterparty,
    salts,
    guardBand: { initiator: 0.006 + rng.next() * 0.018, counterparty: 0.015 + rng.next() * 0.03 },
    allocation,
  };
}

/** The provider's true lowest price for this enclave: its price/margin floor, or the floor its allocated resources impose. */
export const initiatorFloor = (v: Pick<SealedVault, "initiator" | "allocation">) => Math.max(effectiveFloor(v.initiator), resourceFloorUsd(v.initiator.resources, v.allocation));
export const sellerReserve = (v: SealedVault) => Math.ceil((initiatorFloor(v) * (1 + v.guardBand.initiator)) / 10) * 10;
export const buyerReserve = (v: SealedVault) => Math.floor((effectiveCeiling(v.counterparty) * (1 - v.guardBand.counterparty)) / 10) * 10;

export function initiatorBrief(v: SealedVault): InitiatorBrief {
  const m = v.initiator;
  return { anchorPriceUsd: m.anchorPriceUsd, reservePriceUsd: sellerReserve(v), maxNetDays: m.maxNetDays, maxSlaTier: m.maxSlaTier, autoSettleCeilingUsd: m.autoSettleCeilingUsd };
}

export function counterpartyPolicy(v: SealedVault): CounterpartyPolicy {
  const reserve = buyerReserve(v);
  const c = v.counterparty;
  const opening = c.openingPriceUsd !== undefined ? Math.min(c.openingPriceUsd, reserve) : Math.floor((reserve * 0.7) / 10) * 10;
  return { reservePriceUsd: reserve, openingPriceUsd: opening, requiredSlaTier: c.requiredSlaTier, targetNetDays: c.targetNetDays };
}

export const commitment = (sha256: (s: string) => string, mandate: unknown, salt: string) => sha256(canonicalize({ mandate, salt }));

/** Private numbers of one side that must never appear in text the other side reads. */
export function privateFigures(v: SealedVault, side: "initiator" | "counterparty"): { usd: number[]; pct: number[] } {
  if (side === "initiator") {
    const m = v.initiator;
    const unitFloors = Object.values(m.resources ?? {}).map((r) => r.floorUnitPriceUsd).filter((x) => x > 0);
    return { usd: [m.floorPriceUsd, m.costBasisUsd, effectiveFloor(m), initiatorFloor(v), m.autoSettleCeilingUsd, ...unitFloors], pct: [m.minMarginPct] };
  }
  const c = v.counterparty;
  return { usd: [c.ceilingPriceUsd, c.maxBudgetUsd, effectiveCeiling(c)], pct: [] };
}

const NUMBER = /(?:\$\s?)?(\d{1,3}(?:[,\s]\d{3})+|\d+)(?:\.(\d+))?\s*(k|K|m|M)?(?![\w])(\s*%)?/g;

/**
 * Redacts any figure within 1% of a private dollar limit, or within half its own rounding precision ("$41k" is
 * caught near 41,370), in any common spelling (41370, 41,370, $41.4k), and any percentage within 0.5 points of a
 * private percentage. `allow` lists public figures (the offer being made) that are never redacted. Applied to every
 * message one side's engine writes before the other side can read it.
 */
export function scrubLeaks(text: string, figures: { usd: number[]; pct: number[] }, allow: number[] = []): { text: string; redactions: number } {
  let redactions = 0;
  const out = text.replace(NUMBER, (m, int: string, frac: string | undefined, unit: string | undefined, pct: string | undefined) => {
    const base = parseFloat(`${int.replace(/[,\s]/g, "")}${frac ? `.${frac}` : ""}`);
    if (!Number.isFinite(base)) return m;
    if (pct) {
      if (figures.pct.some((p) => Math.abs(p - base) <= 0.5)) {
        redactions++;
        return "[sealed]";
      }
      return m;
    }
    const mult = unit?.toLowerCase() === "k" ? 1e3 : unit?.toLowerCase() === "m" ? 1e6 : 1;
    const value = base * mult;
    if (allow.some((a) => Math.abs(a - value) < 0.5)) return m;
    const precision = mult * 10 ** -(frac?.length ?? 0);
    if (figures.usd.some((f) => f > 0 && Math.abs(value - f) <= Math.max(f * 0.01, precision / 2))) {
      redactions++;
      return "[sealed]";
    }
    return m;
  });
  return { text: out, redactions };
}
