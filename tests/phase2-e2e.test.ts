import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AgentKey,
  authHeaders,
  clampPrice,
  commitMandate,
  receiptFromTranscript,
  RelayError,
  RelayTransport,
  signReceipt,
  signRequest,
  verifyTranscript,
  type Mandate,
  type MandateOpening,
  type RoomEvent,
} from "@bloom-exchange/sdk";
import { priceOf, withPrice, type ComputeGpuTerms } from "@bloom-exchange/schemas";
import { bootRelay } from "./relay-harness.ts";

/**
 * Phase 2, end to end, against a real relay over HTTP and WebSocket: two agents with fresh Ed25519 keys publish,
 * discover, negotiate PROPOSE -> COUNTER -> COUNTER -> ACCEPT -> CLEAR, and the dual-signed receipt verifies
 * offline with its Merkle proof and both mandate openings. Every relay response is recorded and swept for the
 * private mandate limits and salts, which must never reach the relay.
 */
const BUYER_MAX = "912345"; // USD cents: odd numbers, so a leak cannot hide inside a round offer
const SELLER_MIN = "701234";

let relay: Awaited<ReturnType<typeof bootRelay>>;
let seller: RelayTransport;
let buyer: RelayTransport;
let outsider: RelayTransport;
const wire: string[] = [];
const recording: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (!(init?.headers && JSON.stringify(init.headers).includes("text/event-stream"))) wire.push(await res.clone().text());
  return res;
};

const spec: ComputeGpuTerms = {
  vertical: "compute.gpu",
  accelerator: "H100-SXM-80GB",
  acceleratorCount: 8,
  vramGb: 80,
  durationSeconds: 86_400,
  containerDigest: `sha256:${"3f".repeat(32)}`,
  totalPriceAtomic: "990000",
  currency: "USD",
};

let sellerMandate: { commitment: string; opening: MandateOpening };
let buyerMandate: { commitment: string; opening: MandateOpening };
let intentId: string;
let roomId: string;
let receiptHashHex: string;
const wsSeen: RoomEvent[] = [];
const sseSeen: RoomEvent[] = [];
const subs: { close(): void }[] = [];

beforeAll(async () => {
  relay = await bootRelay();
  const [s, b, o] = await Promise.all([AgentKey.generate(), AgentKey.generate(), AgentKey.generate()]);
  seller = new RelayTransport({ baseUrl: relay.url, key: s, fetch: recording });
  buyer = new RelayTransport({ baseUrl: relay.url, key: b, fetch: recording });
  outsider = new RelayTransport({ baseUrl: relay.url, key: o, fetch: recording });
  const sm: Mandate = { vertical: "compute.gpu", role: "seller", currency: "USD", limitAtomic: SELLER_MIN };
  const bm: Mandate = { vertical: "compute.gpu", role: "buyer", currency: "USD", limitAtomic: BUYER_MAX };
  [sellerMandate, buyerMandate] = await Promise.all([commitMandate(sm), commitMandate(bm)]);
});

afterAll(async () => {
  subs.forEach((x) => x.close());
  await relay.close();
});

const waitFor = async (cond: () => boolean, ms = 5_000) => {
  const until = Date.now() + ms;
  while (!cond() && Date.now() < until) await new Promise((r) => setTimeout(r, 25));
  return cond();
};

describe("Phase 2 relay, end to end", () => {
  it("is healthy with zero configuration", async () => {
    const h = (await (await fetch(`${relay.url}/health`)).json()) as { ok: boolean; store: string; nonces: string };
    expect(h).toMatchObject({ ok: true, store: "memory", nonces: "memory" });
  });

  it("registers both agents with fresh Ed25519 keys", async () => {
    const s = await seller.registerAgent({ displayName: "GPU Seller Agent", org: "Northwind Compute", domain: "agents.northwind.example" });
    const b = await buyer.registerAgent({ displayName: "Procurement Agent", org: "Acme Research" });
    expect(s.agent.pubkey).toBe(seller.key.publicKey);
    expect(s.agent.domainVerified).toBe(false); // claimed, not verified: domain proofs are not built
    expect(b.agent.pubkey).toBe(buyer.key.publicKey);
  });

  it("publishes a compute.gpu intent and discovers it with filters", async () => {
    const intent = await seller.publishIntent({ vertical: "compute.gpu", role: "seller", capabilityTags: ["h100", "eu-west"], spec, ttlSeconds: 3_600 });
    intentId = intent.id;
    expect(intent).toMatchObject({ owner: seller.key.publicKey, status: "OPEN", vertical: "compute.gpu", capabilityTags: ["eu-west", "h100"] });
    const found = await buyer.discoverIntents({ vertical: "compute.gpu", role: "seller", tag: "h100" });
    expect(found.map((i) => i.id)).toContain(intentId);
    expect(await buyer.discoverIntents({ tag: "a100" })).toEqual([]);
    expect(await buyer.discoverIntents({ minCompletedDeals: 1 })).toEqual([]); // no reputation yet
  });

  it("negotiates PROPOSE -> COUNTER -> COUNTER -> ACCEPT, each offer clamped on the edge", async () => {
    // The buyer opens with a low bid, clamped to its own ceiling (a no-op here, but the edge always clamps).
    const open = await buyer.openRoom({ intentId, terms: withPrice(spec, clampPrice("650000", buyerMandate.opening.mandate)), mandateCommitment: buyerMandate.commitment, maxRounds: 4 });
    roomId = open.room.id;
    expect(open.room).toMatchObject({ status: "PROPOSED", buyer: { pubkey: buyer.key.publicKey, mandateCommitment: buyerMandate.commitment }, seller: { pubkey: seller.key.publicKey, mandateCommitment: null } });

    subs.push(seller.subscribeRoom(roomId, (e) => wsSeen.push(e), { mode: "ws" }));
    subs.push(buyer.subscribeRoom(roomId, (e) => sseSeen.push(e), { mode: "sse" }));
    expect(await waitFor(() => wsSeen.length >= 1 && sseSeen.length >= 1)).toBe(true);

    // The seller counters at its floor... clamped up: it asked for 640000 but its mandate floor is 701234.
    const sellerAsk = clampPrice("640000", sellerMandate.opening.mandate);
    expect(sellerAsk).toBe(SELLER_MIN);
    const c1 = await seller.sendEvent(roomId, { type: "COUNTER", terms: withPrice(spec, "860000"), mandateCommitment: sellerMandate.commitment });
    expect(c1.room).toMatchObject({ status: "COUNTERED", rounds: 1 });
    const c2 = await buyer.sendEvent(roomId, { type: "COUNTER", terms: withPrice(spec, clampPrice("780000", buyerMandate.opening.mandate)) });
    expect(c2.room.rounds).toBe(2);
    const acc = await seller.sendEvent(roomId, { type: "ACCEPT" });
    expect(acc.room.status).toBe("ACCEPTED");
    expect(acc.room.accepted?.priceAtomic).toBe("780000");
  });

  it("refuses illegal moves: out of turn, outsiders, closed transitions", async () => {
    await expect(buyer.sendEvent(roomId, { type: "COUNTER", terms: withPrice(spec, "1") })).rejects.toMatchObject({ status: 409, code: "bad_transition" });
    await expect(outsider.getRoom(roomId)).rejects.toMatchObject({ status: 404, code: "room_not_found" });
    await expect(outsider.sendEvent(roomId, { type: "REJECT" })).rejects.toMatchObject({ status: 404 });
  });

  it("derives the receipt from the signed transcript, dual-signs it and clears it", async () => {
    const [b, s] = await Promise.all([buyer.prepareReceipt(roomId), seller.prepareReceipt(roomId)]);
    expect(b.hash).toBe(s.hash);
    receiptHashHex = b.hash;
    const { events } = await buyer.getRoom(roomId);
    expect(await verifyTranscript(events)).toBeNull();
    expect(await receiptFromTranscript(b.room, events)).toEqual(b.receipt);
    expect(b.receipt).toMatchObject({ priceAtomic: "780000", currency: "USD", rounds: 2, buyer: { mandateCommitment: buyerMandate.commitment }, seller: { mandateCommitment: sellerMandate.commitment } });
    expect(priceOf(b.receipt.terms as ComputeGpuTerms)).toBe("780000");

    const buyerSig = await signReceipt(buyer.key, b.hash);
    const sellerSig = await signReceipt(seller.key, s.hash);
    await buyer.sendEvent(roomId, { type: "SIGN", signature: buyerSig });
    await seller.sendEvent(roomId, { type: "SIGN", signature: sellerSig });

    // A receipt with the price changed by one cent is refused, even with genuine signatures over the real one.
    await expect(seller.sendEvent(roomId, { type: "CLEAR", receipt: { ...b.receipt, priceAtomic: "779999" }, signatures: { buyer: buyerSig, seller: sellerSig } })).rejects.toMatchObject({ status: 422, code: "receipt_mismatch" });
    // So is the real receipt with a signature swapped.
    await expect(seller.sendEvent(roomId, { type: "CLEAR", receipt: b.receipt, signatures: { buyer: sellerSig, seller: sellerSig } })).rejects.toMatchObject({ status: 422, code: "bad_signature" });

    const cleared = (await seller.sendEvent(roomId, { type: "CLEAR", receipt: b.receipt, signatures: { buyer: buyerSig, seller: sellerSig } })) as Awaited<ReturnType<RelayTransport["sendEvent"]>> & { receipt?: { hash: string; leafIndex: number; verifyUrl: string } };
    expect(cleared.room.status).toBe("CLEARED");
    expect(cleared.receipt).toEqual({ hash: b.hash, leafIndex: 0, verifyUrl: `https://bloom-exchange-verify.vercel.app/r/${b.hash}` });
    await expect(buyer.sendEvent(roomId, { type: "REJECT" })).rejects.toMatchObject({ status: 409, code: "room_closed" });
  });

  it("streams every move to both subscribers, in order, over WebSocket and SSE", async () => {
    const all = (await buyer.getRoom(roomId)).events;
    expect(all.map((e) => e.type)).toEqual(["PROPOSE", "COUNTER", "COUNTER", "ACCEPT", "SIGN", "SIGN", "CLEAR"]);
    expect(await waitFor(() => wsSeen.length === all.length && sseSeen.length === all.length)).toBe(true);
    expect(wsSeen.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(sseSeen.map((e) => e.hash)).toEqual(all.map((e) => e.hash));
  });

  it("verifies the receipt from GET /v1/receipts/:hash with no trust in the relay", async () => {
    const v = await outsider.verifyReceipt(receiptHashHex, [buyerMandate.opening, sellerMandate.opening]);
    expect(v.valid).toBe(true);
    expect(v.checks).toEqual({ canonicalHash: "pass", buyerSignature: "pass", sellerSignature: "pass", mandateBounds: "pass", ledgerInclusion: "pass" });
    expect(v.payload.ledger).toMatchObject({ leafIndex: 0, treeSize: 1 });
    // Without openings the bounds stay sealed, and a wrong opening fails.
    expect((await outsider.verifyReceipt(v.payload)).checks.mandateBounds).toBe("sealed");
    const lowered = await commitMandate({ ...buyerMandate.opening.mandate, limitAtomic: "700000" }, buyerMandate.opening.salt);
    expect((await outsider.verifyReceipt(v.payload, [lowered.opening])).checks.mandateBounds).toBe("fail");
    // A tampered copy fails its hash and both signatures.
    const forged = { ...v.payload, receipt: { ...v.payload.receipt, priceAtomic: "1" } };
    expect((await outsider.verifyReceipt(forged)).checks).toMatchObject({ canonicalHash: "fail", buyerSignature: "fail", sellerSignature: "fail" });
  });

  it("updates both agents' reputation, and discovery by reputation", async () => {
    for (const t of [seller, buyer]) {
      const r = await outsider.getReputation(t.key.publicKey);
      expect(r).toMatchObject({ completedDeals: 1, disputeRate: 0, domainVerified: false });
      expect(r.medianLatencyMs).toBeGreaterThanOrEqual(0);
      expect(r.recentReceipts.map((x) => x.hash)).toEqual([receiptHashHex]);
    }
    expect((await outsider.getReputation(seller.key.publicKey)).org).toBe("Northwind Compute");
    expect((await buyer.discoverIntents({ minCompletedDeals: 1 })).map((i) => i.id)).toEqual([intentId]);
    const feed = (await (await fetch(`${relay.url}/v1/feed`)).json()) as { cleared: number; receipts: { hash: string }[] };
    expect(feed.cleared).toBe(1);
    expect(feed.receipts[0].hash).toBe(receiptHashHex);
  });

  it("rejects replays, clock drift, bad signatures and unsigned WebSocket upgrades", async () => {
    const target = `/v1/rooms/${roomId}`;
    const a = await signRequest(buyer.key, "GET", target);
    const first = await fetch(`${relay.url}${target}`, { headers: authHeaders(a) });
    expect(first.status).toBe(200);
    const replay = await fetch(`${relay.url}${target}`, { headers: authHeaders(a) });
    expect(replay.status).toBe(401);
    expect(((await replay.json()) as { error: { code: string } }).error.code).toBe("auth_replay");
    const stale = await signRequest(buyer.key, "GET", target, "", Date.now() - 31_000);
    expect(((await (await fetch(`${relay.url}${target}`, { headers: authHeaders(stale) })).json()) as { error: { code: string } }).error.code).toBe("auth_clock_drift");
    const other = await signRequest(buyer.key, "GET", `${target}?x=1`);
    expect(((await (await fetch(`${relay.url}${target}`, { headers: authHeaders(other) })).json()) as { error: { code: string } }).error.code).toBe("auth_signature");
    const body = JSON.stringify({ displayName: "x" });
    const signedBody = await signRequest(buyer.key, "POST", "/v1/agents", body);
    const swapped = await fetch(`${relay.url}/v1/agents`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders(signedBody) }, body: JSON.stringify({ displayName: "y" }) });
    expect(swapped.status).toBe(401);
    const unsigned = await new Promise<string>((resolve) => {
      const ws = new WebSocket(`${relay.url.replace("http", "ws")}/v1/rooms/${roomId}/stream`);
      ws.onopen = () => resolve("open");
      ws.onerror = () => resolve("refused");
    });
    expect(unsigned).toBe("refused");
  });

  it("never let a mandate limit or salt reach the relay, in any response or in its store", async () => {
    const secrets = [BUYER_MAX, SELLER_MIN, buyerMandate.opening.salt, sellerMandate.opening.salt];
    // Maps serialize as {} by default: expand them, so the sweep covers everything the store holds.
    const dump = JSON.stringify(relay.store, (_k, v) => (v instanceof Map ? [...v.entries()] : v));
    expect(dump).toContain(roomId);
    expect(dump).toContain(receiptHashHex);
    expect(dump.length).toBeGreaterThan(5_000);
    const everything = [...wire, dump].join("\n");
    expect(wire.length).toBeGreaterThan(20);
    for (const s of secrets) expect(everything.includes(s), s).toBe(false);
  });

  it("surfaces relay errors as typed RelayErrors", async () => {
    await expect(buyer.getReceipt("0".repeat(64))).rejects.toBeInstanceOf(RelayError);
  });
});
