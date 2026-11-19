import { canonicalize, offerPrice, receiptDraft, receiptHash, SIGNATURE, TERMINAL, verifyReceiptSignature, type Room, type RoomEventType } from "@bloom-exchange/sdk";
import { validateTermsFor, type Vertical } from "@bloom-exchange/schemas";

/**
 * The room state machine. Pure apart from signature checks: given a room, a move and its author, it returns the
 * next room or a MoveError. The relay enforces it; anyone can re-derive it from the transcript.
 *
 *   PROPOSED  -> COUNTERED | ACCEPTED | REJECTED | EXPIRED
 *   COUNTERED -> COUNTERED (at most maxRounds counters) | ACCEPTED | REJECTED | EXPIRED
 *   ACCEPTED  -> CLEARED (a valid, dual-signed receipt equal to the room's draft)
 *
 * Turns: only the party who did not make the standing offer may COUNTER or ACCEPT it; either may REJECT. Each party
 * commits to its sealed mandate (a 64-hex commitment, never the mandate) with its first move, and cannot change it.
 */
export class MoveError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const HEX64 = /^[0-9a-f]{64}$/;
const deny = (status: number, code: string, message: string): never => {
  throw new MoveError(status, code, message);
};

export type Move = { type: Exclude<RoomEventType, "PROPOSE" | "EXPIRE">; body: Record<string, unknown> };
export type Applied = { room: Room; receipt?: { hash: string; body: ReturnType<typeof receiptDraft>; signatures: { buyer: string; seller: string } } };

export const roleOf = (room: Room, pubkey: string): "buyer" | "seller" | null => (room.buyer.pubkey === pubkey ? "buyer" : room.seller.pubkey === pubkey ? "seller" : null);

const ALLOWED: Record<Move["type"], string[]> = {
  COUNTER: ["type", "terms", "mandateCommitment"],
  ACCEPT: ["type", "mandateCommitment"],
  REJECT: ["type"],
  SIGN: ["type", "signature"],
  CLEAR: ["type", "receipt", "signatures"],
};

export function parseMove(body: unknown): Move {
  if (!body || typeof body !== "object" || Array.isArray(body)) deny(400, "bad_request", "The event body must be a JSON object.");
  const b = body as Record<string, unknown>;
  const type = b.type;
  if (typeof type !== "string" || !(type in ALLOWED)) deny(400, "bad_event_type", "type must be COUNTER, ACCEPT, REJECT, SIGN or CLEAR.");
  const unknown = Object.keys(b).filter((k) => !ALLOWED[type as Move["type"]].includes(k));
  if (unknown.length) deny(400, "unknown_field", `Unknown field for ${type as string}.`);
  if (b.mandateCommitment !== undefined && (typeof b.mandateCommitment !== "string" || !HEX64.test(b.mandateCommitment))) deny(400, "bad_commitment", "mandateCommitment must be 64 lowercase hex (a salted SHA-256 commitment, never the mandate).");
  return { type: type as Move["type"], body: b };
}

/** Sets a party's commitment on its first move; a later move may repeat it but never change it. */
function commit(room: Room, role: "buyer" | "seller", value: unknown): Room {
  const current = room[role].mandateCommitment;
  if (value === undefined) {
    if (!current) deny(422, "mandate_commitment_required", "Your first move must carry your mandateCommitment.");
    return room;
  }
  if (current && current !== value) deny(409, "commitment_changed", "A mandate commitment cannot change within a room.");
  return { ...room, [role]: { ...room[role], mandateCommitment: value as string } };
}

/** Validates offered terms for the room's vertical and returns the canonical copy and its price. */
export function offer(room: Room, terms: unknown) {
  const v = validateTermsFor(room.vertical as Vertical, terms);
  if (!v.ok) deny(422, "invalid_terms", v.errors.slice(0, 5).join("; "));
  const t = (v as { ok: true; value: Record<string, unknown> }).value;
  return { terms: t, ...offerPrice(t) };
}

export const isExpired = (room: Room, now: Date) => !TERMINAL.includes(room.status) && room.status !== "ACCEPTED" && now.getTime() >= Date.parse(room.expiresAt);

export async function applyMove(room: Room, move: Move, actor: string, at: string, seq: number): Promise<Applied> {
  const role = roleOf(room, actor);
  if (!role) deny(403, "not_a_participant", "Only the room's buyer and seller may act in it.");
  const r = role as "buyer" | "seller";
  if (TERMINAL.includes(room.status)) deny(409, "room_closed", `The room is ${room.status}.`);
  const open = room.status === "PROPOSED" || room.status === "COUNTERED";

  switch (move.type) {
    case "COUNTER": {
      if (!open) deny(409, "bad_transition", `Cannot COUNTER a room that is ${room.status}.`);
      if (room.lastOffer?.by === actor) deny(409, "not_your_turn", "You made the standing offer; wait for the counterparty.");
      if (room.rounds >= room.maxRounds) deny(409, "max_rounds", `This room allows ${room.maxRounds} counter-offers.`);
      const next = commit(room, r, move.body.mandateCommitment);
      const o = offer(next, move.body.terms);
      if (o.currency !== room.lastOffer?.currency) deny(422, "currency_changed", "A counter-offer must keep the currency.");
      return { room: { ...next, status: "COUNTERED", rounds: room.rounds + 1, lastOffer: { ...o, by: actor, seq } } };
    }
    case "ACCEPT": {
      if (!open) deny(409, "bad_transition", `Cannot ACCEPT a room that is ${room.status}.`);
      if (!room.lastOffer) deny(409, "nothing_to_accept", "There is no standing offer.");
      if (room.lastOffer!.by === actor) deny(409, "not_your_turn", "You cannot accept your own offer.");
      const next = commit(room, r, move.body.mandateCommitment);
      if (!next.buyer.mandateCommitment || !next.seller.mandateCommitment) deny(409, "commitments_incomplete", "Both parties must have committed to their mandates.");
      const lo = room.lastOffer!;
      return { room: { ...next, status: "ACCEPTED", accepted: { terms: lo.terms, priceAtomic: lo.priceAtomic, currency: lo.currency, at, eventHash: "" } } };
    }
    case "REJECT": {
      if (!open) deny(409, "bad_transition", `Cannot REJECT a room that is ${room.status}.`);
      return { room: { ...room, status: "REJECTED" } };
    }
    case "SIGN": {
      if (room.status !== "ACCEPTED") deny(409, "bad_transition", "Signatures are exchanged only once a room is ACCEPTED.");
      const sig = move.body.signature;
      if (typeof sig !== "string" || !SIGNATURE.test(sig)) deny(400, "bad_signature", "signature must be an Ed25519 signature, base64url.");
      const hash = await receiptHash(receiptDraft(room));
      if (!(await verifyReceiptSignature(actor, hash, sig as string))) deny(422, "bad_signature", "The signature does not verify over this room's receipt.");
      return { room: { ...room, signatures: { ...room.signatures, [r]: sig as string } } };
    }
    case "CLEAR": {
      if (room.status !== "ACCEPTED") deny(409, "bad_transition", `Cannot CLEAR a room that is ${room.status}.`);
      const draft = receiptDraft(room);
      if (canonicalize(move.body.receipt) !== canonicalize(draft)) deny(422, "receipt_mismatch", "The receipt is not this room's canonical receipt.");
      const sigs = move.body.signatures as { buyer?: unknown; seller?: unknown } | undefined;
      const hash = await receiptHash(draft);
      const buyerOk = typeof sigs?.buyer === "string" && (await verifyReceiptSignature(room.buyer.pubkey, hash, sigs.buyer));
      const sellerOk = typeof sigs?.seller === "string" && (await verifyReceiptSignature(room.seller.pubkey, hash, sigs.seller));
      if (!buyerOk || !sellerOk) deny(422, "bad_signature", `The ${!buyerOk ? "buyer's" : "seller's"} receipt signature does not verify.`);
      const signatures = { buyer: sigs!.buyer as string, seller: sigs!.seller as string };
      return { room: { ...room, status: "CLEARED", receiptHash: hash, signatures }, receipt: { hash, body: draft, signatures } };
    }
  }
}
