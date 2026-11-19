import { canonicalize } from "./canonical.ts";
import { sha256HexOf } from "./bytes.ts";
import { AgentKey, PUBKEY, verifyEd25519 } from "./agent-key.ts";
import { commitmentOf, withinMandate, type MandateOpening } from "./mandate.ts";
import { authString, EMPTY_BODY_SHA256 } from "./relay-auth.ts";
import { verifyInclusion } from "./merkle.ts";

/**
 * The Bloom relay protocol: rooms, their hash-chained event transcript, and the dual-signed receipt. Both the relay
 * and every edge use these exact functions, so a receipt draft or a transcript hash is computed identically on
 * both sides and either party can check the other.
 *
 * State machine (enforced by the relay, re-checkable from the transcript):
 *   PROPOSED  -> COUNTERED | ACCEPTED | REJECTED | EXPIRED
 *   COUNTERED -> COUNTERED (until maxRounds counters) | ACCEPTED | REJECTED | EXPIRED
 *   ACCEPTED  -> CLEARED   (only on a valid, dual-signed canonical receipt)
 */
export type RoomStatus = "PROPOSED" | "COUNTERED" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "CLEARED";
export const TERMINAL: readonly RoomStatus[] = ["REJECTED", "EXPIRED", "CLEARED"];
export type RoomEventType = "PROPOSE" | "COUNTER" | "ACCEPT" | "REJECT" | "SIGN" | "CLEAR" | "EXPIRE";

export type Party = { pubkey: string; mandateCommitment: string | null };

/**
 * One move. `by` is the author's public key ("relay" only for EXPIRE). `auth` is the author's own request
 * signature over the exact raw body, so anyone can check every move was made by that key: the relay cannot forge
 * a move, only refuse one.
 */
export type RoomEvent = {
  roomId: string;
  seq: number;
  type: RoomEventType;
  by: string;
  body: Record<string, unknown>;
  at: string;
  prevHash: string;
  hash: string;
  auth: { method: string; path: string; timestamp: string; nonce: string; signature: string; raw: string } | null;
};

export type Room = {
  id: string;
  /** The relay's public origin: part of every receipt, so a receipt names where it cleared. */
  relay: string;
  intentId: string;
  vertical: string;
  status: RoomStatus;
  buyer: Party;
  seller: Party;
  lastOffer: { terms: Record<string, unknown>; priceAtomic: string; currency: string; by: string; seq: number } | null;
  /** COUNTER events so far. */
  rounds: number;
  maxRounds: number;
  openedAt: string;
  expiresAt: string;
  accepted: { terms: Record<string, unknown>; priceAtomic: string; currency: string; at: string; eventHash: string } | null;
  signatures: { buyer?: string; seller?: string };
  receiptHash: string | null;
  transcriptHead: string;
  seq: number;
};

export const GENESIS_HASH = "0".repeat(64);

export function eventHash(e: Pick<RoomEvent, "roomId" | "seq" | "type" | "by" | "body" | "at" | "prevHash">): Promise<string> {
  return sha256HexOf(canonicalize({ domain: "bloom-room-event/1", roomId: e.roomId, seq: e.seq, type: e.type, by: e.by, body: e.body, at: e.at, prevHash: e.prevHash }));
}

/**
 * Re-checks a transcript end to end: the hash chain, and each authored move's request signature over its raw
 * body (and that the raw body is the body the chain hashed). Returns the first problem, or null.
 */
export async function verifyTranscript(events: RoomEvent[]): Promise<string | null> {
  let prev = GENESIS_HASH;
  for (const [i, e] of events.entries()) {
    if (e.seq !== i + 1) return `event ${e.seq}: out of sequence`;
    if (e.prevHash !== prev) return `event ${e.seq}: broken chain`;
    if ((await eventHash(e)) !== e.hash) return `event ${e.seq}: hash mismatch`;
    prev = e.hash;
    if (e.type === "EXPIRE") {
      if (e.by !== "relay" || e.auth) return `event ${e.seq}: only the relay records expiry`;
      continue;
    }
    if (!e.auth || !PUBKEY.test(e.by)) return `event ${e.seq}: unsigned move`;
    let parsed: unknown;
    try {
      parsed = JSON.parse(e.auth.raw);
    } catch {
      return `event ${e.seq}: raw body is not JSON`;
    }
    if (canonicalize(parsed) !== canonicalize(e.body)) return `event ${e.seq}: raw body differs from the recorded body`;
    const bodyHash = e.auth.raw ? await sha256HexOf(e.auth.raw) : EMPTY_BODY_SHA256;
    if (!(await verifyEd25519(e.by, e.auth.signature, authString(e.auth.method, e.auth.path, e.auth.timestamp, e.auth.nonce, bodyHash)))) return `event ${e.seq}: signature does not verify`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------------------------------------

export const RECEIPT_VERSION = "bloom-relay-receipt/1";

export type RelayReceipt = {
  version: typeof RECEIPT_VERSION;
  relay: string;
  roomId: string;
  intentId: string;
  vertical: string;
  buyer: { pubkey: string; mandateCommitment: string };
  seller: { pubkey: string; mandateCommitment: string };
  terms: Record<string, unknown>;
  priceAtomic: string;
  currency: string;
  rounds: number;
  openedAt: string;
  acceptedAt: string;
  /** Hash of the ACCEPT event: the receipt binds the whole transcript up to acceptance. */
  transcriptHead: string;
};

/** The receipt both parties sign once a room is ACCEPTED. Deterministic: every edge derives the same one. */
export function receiptDraft(room: Room): RelayReceipt {
  if (!room.accepted) throw new Error("receiptDraft: the room has not been accepted");
  if (!room.buyer.mandateCommitment || !room.seller.mandateCommitment) throw new Error("receiptDraft: both mandate commitments are required");
  return {
    version: RECEIPT_VERSION,
    relay: room.relay,
    roomId: room.id,
    intentId: room.intentId,
    vertical: room.vertical,
    buyer: { pubkey: room.buyer.pubkey, mandateCommitment: room.buyer.mandateCommitment },
    seller: { pubkey: room.seller.pubkey, mandateCommitment: room.seller.mandateCommitment },
    terms: room.accepted.terms,
    priceAtomic: room.accepted.priceAtomic,
    currency: room.accepted.currency,
    rounds: room.rounds,
    openedAt: room.openedAt,
    acceptedAt: room.accepted.at,
    transcriptHead: room.accepted.eventHash,
  };
}

/** The figure a negotiation moves: the unit price for inference terms, the total otherwise (as in @bloom-exchange/schemas). */
export function offerPrice(terms: Record<string, unknown>): { priceAtomic: string; currency: string } {
  const price = terms.vertical === "api.inference" ? terms.unitPriceAtomic : terms.totalPriceAtomic;
  return { priceAtomic: typeof price === "string" ? price : "", currency: typeof terms.currency === "string" ? terms.currency : "" };
}

/**
 * Rebuilds the receipt from the signed transcript alone, trusting the relay only for the room's public metadata
 * (origin, intent, vertical, party keys), which an edge can check against the intent it answered. An edge signs
 * only if this equals `receiptDraft(room)`: a relay that misreports the accepted terms gets no signature.
 */
export async function receiptFromTranscript(room: Pick<Room, "relay" | "id" | "intentId" | "vertical" | "buyer" | "seller">, events: RoomEvent[]): Promise<RelayReceipt> {
  const problem = await verifyTranscript(events);
  if (problem) throw new Error(`transcript: ${problem}`);
  const acceptAt = events.findIndex((e) => e.type === "ACCEPT");
  if (acceptAt < 0) throw new Error("transcript: no ACCEPT");
  const before = events.slice(0, acceptAt);
  const offers = before.filter((e) => e.type === "PROPOSE" || e.type === "COUNTER");
  const last = offers.at(-1);
  if (!last || events[0]?.type !== "PROPOSE") throw new Error("transcript: no offer before ACCEPT");
  const terms = last.body.terms as Record<string, unknown>;
  const commitmentOfParty = (pubkey: string) => {
    const first = events.slice(0, acceptAt + 1).find((e) => e.by === pubkey && typeof e.body.mandateCommitment === "string");
    return (first?.body.mandateCommitment as string | undefined) ?? null;
  };
  const buyerC = commitmentOfParty(room.buyer.pubkey);
  const sellerC = commitmentOfParty(room.seller.pubkey);
  if (!buyerC || !sellerC) throw new Error("transcript: a mandate commitment is missing");
  const accept = events[acceptAt];
  return {
    version: RECEIPT_VERSION,
    relay: room.relay,
    roomId: room.id,
    intentId: room.intentId,
    vertical: room.vertical,
    buyer: { pubkey: room.buyer.pubkey, mandateCommitment: buyerC },
    seller: { pubkey: room.seller.pubkey, mandateCommitment: sellerC },
    terms,
    ...offerPrice(terms),
    rounds: before.filter((e) => e.type === "COUNTER").length,
    openedAt: events[0].at,
    acceptedAt: accept.at,
    transcriptHead: accept.hash,
  };
}

export const receiptHash = (r: RelayReceipt): Promise<string> => sha256HexOf(canonicalize(r));
export const receiptSigningInput = (hash: string) => `BLOOM-RELAY-RECEIPT-v1\n${hash}`;
export const signReceipt = (key: AgentKey, hash: string): Promise<string> => key.sign(receiptSigningInput(hash));
export const verifyReceiptSignature = (pubkey: string, hash: string, signature: string): Promise<boolean> => verifyEd25519(pubkey, signature, receiptSigningInput(hash));

/** What GET /v1/receipts/:hash returns: everything needed to verify the receipt offline. */
export type ReceiptPayload = {
  hash: string;
  receipt: RelayReceipt;
  signatures: { buyer: string; seller: string };
  clearedAt: string;
  revoked: boolean;
  ledger: { leafIndex: number; treeSize: number; root: string; proof: string[] };
};

export type ReceiptCheck = "pass" | "fail";
export type ReceiptVerification = {
  /** The cryptographic checks all pass and the receipt is not revoked. */
  valid: boolean;
  checks: {
    canonicalHash: ReceiptCheck;
    buyerSignature: ReceiptCheck;
    sellerSignature: ReceiptCheck;
    /** "sealed": the mandates were not opened, so the bounds are committed to but not shown. */
    mandateBounds: ReceiptCheck | "sealed";
    /** "unavailable": no ledger proof was supplied (for example, a pasted receipt with no relay to ask). */
    ledgerInclusion: ReceiptCheck | "unavailable";
  };
  revoked: boolean;
  problems: string[];
};

/**
 * Verifies a receipt with no trust in the relay: canonical hash, both Ed25519 signatures, the Merkle inclusion
 * proof (when given) and, for each mandate opening supplied, that it opens that party's commitment and that the
 * cleared price sits inside it.
 */
export async function verifyRelayReceipt(
  input: { receipt: RelayReceipt; signatures: { buyer?: string; seller?: string }; hash?: string; ledger?: ReceiptPayload["ledger"] | null; revoked?: boolean },
  openings: MandateOpening[] = [],
): Promise<ReceiptVerification> {
  const problems: string[] = [];
  const r = input.receipt;
  const hash = await receiptHash(r).catch(() => "");
  const canonicalHash: ReceiptCheck = hash && (!input.hash || input.hash === hash) && r?.version === RECEIPT_VERSION ? "pass" : "fail";
  if (canonicalHash === "fail") problems.push(r?.version !== RECEIPT_VERSION ? "unknown receipt version" : "the receipt does not hash to the stated hash");
  const buyerSignature: ReceiptCheck = hash && input.signatures?.buyer && (await verifyReceiptSignature(r.buyer?.pubkey, hash, input.signatures.buyer)) ? "pass" : "fail";
  const sellerSignature: ReceiptCheck = hash && input.signatures?.seller && (await verifyReceiptSignature(r.seller?.pubkey, hash, input.signatures.seller)) ? "pass" : "fail";
  if (buyerSignature === "fail") problems.push("the buyer's signature does not verify");
  if (sellerSignature === "fail") problems.push("the seller's signature does not verify");

  let mandateBounds: ReceiptVerification["checks"]["mandateBounds"] = "sealed";
  for (const o of openings) {
    const party = o.mandate?.role === "buyer" ? r.buyer : o.mandate?.role === "seller" ? r.seller : null;
    const opens = party && (await commitmentOf(o).catch(() => "")) === party.mandateCommitment;
    const inside = opens && o.mandate.vertical === r.vertical && withinMandate(r.priceAtomic, r.currency, o.mandate);
    if (!inside) {
      mandateBounds = "fail";
      problems.push(opens ? `the cleared price is outside the ${o.mandate.role}'s mandate` : "a mandate opening does not match its commitment");
    } else if (mandateBounds !== "fail") mandateBounds = "pass";
  }

  let ledgerInclusion: ReceiptVerification["checks"]["ledgerInclusion"] = "unavailable";
  if (input.ledger) {
    const l = input.ledger;
    ledgerInclusion = hash && (await verifyInclusion(hash, l.leafIndex, l.treeSize, l.proof, l.root)) ? "pass" : "fail";
    if (ledgerInclusion === "fail") problems.push("the Merkle inclusion proof does not verify");
  }
  const revoked = input.revoked === true;
  if (revoked) problems.push("the relay marks this receipt revoked");
  const checks = { canonicalHash, buyerSignature, sellerSignature, mandateBounds, ledgerInclusion };
  const valid = canonicalHash === "pass" && buyerSignature === "pass" && sellerSignature === "pass" && mandateBounds !== "fail" && ledgerInclusion !== "fail" && !revoked;
  return { valid, checks, revoked, problems };
}
