import { canonicalize } from "./canonical";
import { RESOURCE_DIMENSIONS, RESOURCE_UNITS, type Allocation, type ResourceDimension, type ResourceOffers, type ResourceProof, type ResourceRequests } from "./types";

/**
 * Sovereign's resource allocator. Runs once per enclave, before any offer, and is fully deterministic: for every
 * dimension the client requests, it grants min(requested, provider capacity). A dimension the provider doesn't
 * offer, or a grant below the client's own minimum, is a bounds breach and goes to the exception queue rather
 * than being negotiated away. The allocated quantities then raise the provider's price floor by Σ granted × unit
 * floor, so no settlement can sell resources below their mandated unit price.
 */

export type AllocationResult = {
  allocation: Allocation;
  /** Dimensions where the request could not be met at all (not offered, or below the client's minimum). */
  shortfalls: { dimension: ResourceDimension; requested: number; available: number; minimum: number }[];
  /** Dimensions where the grant was clamped down to capacity but still met the client's minimum. */
  clamped: ResourceDimension[];
};

const round = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

export function allocate(offers: ResourceOffers | undefined, requests: ResourceRequests | undefined): AllocationResult | null {
  if (!requests || Object.keys(requests).length === 0) return null;
  const allocation: Allocation = {};
  const shortfalls: AllocationResult["shortfalls"] = [];
  const clamped: ResourceDimension[] = [];
  for (const dim of RESOURCE_DIMENSIONS) {
    const req = requests[dim];
    if (!req) continue;
    const offer = offers?.[dim];
    const capacity = offer?.capacity ?? 0;
    const minimum = req.minQuantity ?? req.quantity;
    const granted = round(Math.min(req.quantity, capacity));
    if (granted < minimum || granted <= 0) {
      shortfalls.push({ dimension: dim, requested: req.quantity, available: capacity, minimum });
      continue;
    }
    if (granted < req.quantity) clamped.push(dim);
    allocation[dim] = granted;
  }
  return { allocation, shortfalls, clamped };
}

/** Σ granted × unit floor: the least the allocated resources may be sold for. */
export function resourceFloorUsd(offers: ResourceOffers | undefined, allocation: Allocation | null | undefined): number {
  if (!allocation || !offers) return 0;
  let total = 0;
  for (const dim of RESOURCE_DIMENSIONS) {
    const q = allocation[dim];
    if (q) total += q * (offers[dim]?.floorUnitPriceUsd ?? 0);
  }
  return Math.round(total * 100) / 100;
}

/** Public per-dimension proofs: requested vs granted, plus a salted commitment to the private unit floor. */
export function resourceProofs(offers: ResourceOffers | undefined, requests: ResourceRequests | undefined, allocation: Allocation, salt: string, sha256: (s: string) => string): ResourceProof[] {
  return RESOURCE_DIMENSIONS.filter((d) => allocation[d] !== undefined).map((dimension) => {
    const requested = requests?.[dimension]?.quantity ?? 0;
    const granted = allocation[dimension] ?? 0;
    return {
      dimension,
      unit: RESOURCE_UNITS[dimension],
      requested,
      granted,
      compliance: granted < requested ? "clamped_to_capacity" : "within_mandate",
      floorCommitment: sha256(canonicalize({ dimension, floorUnitPriceUsd: offers?.[dimension]?.floorUnitPriceUsd ?? 0, salt })),
    };
  });
}

/** Whether `allocation` stays within the provider's capacities and meets the client's minimums. */
export function allocationViolations(offers: ResourceOffers | undefined, requests: ResourceRequests | undefined, allocation: Allocation | null | undefined): string[] {
  const out: string[] = [];
  for (const dim of RESOURCE_DIMENSIONS) {
    const q = allocation?.[dim];
    const req = requests?.[dim];
    if (q !== undefined && q > (offers?.[dim]?.capacity ?? 0)) out.push(`initiator:${dim}_above_capacity`);
    if (req && (q ?? 0) < (req.minQuantity ?? req.quantity)) out.push(`counterparty:${dim}_below_minimum`);
  }
  return out;
}
