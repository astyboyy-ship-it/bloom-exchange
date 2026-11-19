import type { Clamp, Environment, ExceptionKind, FirewallVerdict, PeerFramework, Side, SlaTier, Source, ThreatVector } from "../types.ts";

/**
 * Bloom events: the typed, redacted lifecycle feed a node offers to wake-ups, pollers and post-settlement adapters.
 *
 * Every event is built field by field from the enclave record (events/project.ts), never by spreading an internal
 * event, so it carries no mandate figure, no margin, no salt and no free text: no model messages, no exception
 * details, no item descriptions, no peer names. Offer prices appear because both parties already see every offer,
 * and guard bands keep every offer off every private limit.
 */
export const BLOOM_EVENT_TYPES = [
  "negotiation.opened",
  "firewall.scanned",
  "offer.updated",
  "negotiation.clamped",
  "negotiation.exception",
  "negotiation.settled",
  "receipt.issued",
  "negotiation.closed",
] as const;
export type BloomEventType = (typeof BLOOM_EVENT_TYPES)[number];
export const isBloomEventType = (s: string): s is BloomEventType => (BLOOM_EVENT_TYPES as readonly string[]).includes(s);

export type ClampRule = Clamp["rule"];

export type BloomEventData = {
  "negotiation.opened": { framework: PeerFramework; source: Source };
  /** Counts per threat vector only: never the matched text. */
  "firewall.scanned": { verdict: FirewallVerdict; vectors: Partial<Record<ThreatVector, number>> };
  "offer.updated": { round: number; by: Side; priceUsd: number; netDays: number; slaTier: SlaTier; hash: string; prevHash: string };
  /** Which rules Sovereign applied, never the values it clamped from or to (those would reveal the floor). */
  "negotiation.clamped": { round: number; rules: ClampRule[] };
  /** The exception kind only; the operator's detail text names private figures and never leaves the node. */
  "negotiation.exception": { kind: ExceptionKind };
  "negotiation.settled": { certificateId: string; priceUsd: number; netDays: number; slaTier: SlaTier; rounds: number; binding: boolean };
  /** A reference to the signed receipt: enough to fetch and verify it, nothing from inside the vault. */
  "receipt.issued": { certificateId: string; digest: string; kid: string; issuerCard: string; chainHead: string; binding: boolean };
  "negotiation.closed": { state: "failed" | "canceled" };
};

type Envelope = {
  /** Stable per node, log epoch and sequence number: the idempotency key for every adapter. */
  id: string;
  /** Monotonic within one log epoch. */
  seq: number;
  /** Opaque resume point (`<epoch>.<seq>`): pass it back to read the events after this one. */
  cursor: string;
  /**
   * The node that produced the event: its Ed25519 signing key id (`bxk-…`), as its Agent Card publishes it and
   * its receipts are signed. Lets a receiver that aggregates several nodes attribute every event, not just receipts.
   */
  node: string;
  at: string;
  taskId: string;
  contextId: string;
  environment: Environment;
  /**
   * Inherited from the internal event, exactly as the A2A stream uses it. "operator" events (clamps, exception
   * kinds) are provider-side facts: next to the offer prices, "round 4 was clamped to mandate_floor" places the
   * provider's floor within its guard band, so they never reach the counterparty outside its own sandbox.
   */
  audience: "public" | "operator";
};

export type BloomEvent = { [K in BloomEventType]: Envelope & { type: K; data: BloomEventData[K] } }[BloomEventType];

/** An event before the log numbers it (and stamps the node). */
export type BloomEventDraft = BloomEvent extends infer E ? (E extends BloomEvent ? Omit<E, "id" | "seq" | "cursor" | "node"> : never) : never;

export type ReadOptions = { cursor?: string | null; limit?: number; types?: readonly BloomEventType[]; where?: (e: BloomEvent) => boolean };
export type ReadResult = {
  events: BloomEvent[];
  /** Where to resume. Always set, even when no event matched, so pollers never re-scan what they skipped. */
  cursor: string;
  /** True when the given cursor belongs to another log epoch (a restart) or fell off the retained window. */
  reset: boolean;
  hasMore: boolean;
};

// ---------------------------------------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------------------------------------

export type DeliveryResult = { ok: true } | { ok: false; retryable: boolean; reason: string };
export type DeliveryContext = { attempt: number; idempotencyKey: string };
export type AdapterCheck = { ok: boolean; detail: string };

/**
 * A post-event hook. Adapters receive only redacted `BloomEvent`s and must treat anything they read back (a
 * webhook's response, a file's contents) as data, never as instructions: nothing an adapter returns can change a
 * negotiation, a mandate or a clamp.
 */
export interface EventAdapter {
  readonly id: string;
  readonly name: string;
  /** Event types this adapter wants, or "*" for all. */
  readonly events: readonly BloomEventType[] | "*";
  deliver(event: BloomEvent, ctx: DeliveryContext): Promise<DeliveryResult>;
  /** A dry run: validates configuration and reachability rules without delivering anything. */
  check(): Promise<AdapterCheck>;
}
