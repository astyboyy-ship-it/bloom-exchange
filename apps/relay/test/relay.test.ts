import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentKey, authHeaders, commitMandate, RelayTransport, signRequest, verifyTranscript, type RoomEvent } from "@bloom-exchange/sdk";
import { withPrice, type ApiInferenceTerms } from "@bloom-exchange/schemas";
import { bootRelay } from "../../../tests/relay-harness.ts";
import { MemoryNonceStore, UpstashNonceStore } from "../src/nonce.ts";
import { authenticate } from "../src/auth.ts";

/** The relay's state machine, expiry, transport fallbacks and guardrails, against a real local relay. */
let offset = 0;
let relay: Awaited<ReturnType<typeof bootRelay>>;
let sellerKey: AgentKey;
let buyerKey: AgentKey;
let seller: RelayTransport;
let buyer: RelayTransport;
const commit = async (role: "buyer" | "seller") => (await commitMandate({ vertical: "api.inference", role, currency: "USD", limitAtomic: role === "buyer" ? "400" : "200" })).commitment;

const spec: ApiInferenceTerms = { vertical: "api.inference", model: "llama-4-70b", maxInputTokens: 128_000, maxOutputTokens: 4_096, latencySlaMs: 800, unitPriceAtomic: "350", currency: "USD" };

beforeAll(async () => {
  relay = await bootRelay({ now: () => new Date(Date.now() + offset) });
  [sellerKey, buyerKey] = await Promise.all([AgentKey.generate(), AgentKey.generate()]);
  seller = new RelayTransport({ baseUrl: relay.url, key: sellerKey });
  buyer = new RelayTransport({ baseUrl: relay.url, key: buyerKey });
});
afterAll(() => relay.close());

/** A signed request at the relay's (possibly shifted) clock. */
async function call(key: AgentKey, method: "GET" | "POST", path: string, body?: unknown) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const a = await signRequest(key, method, path, raw, Date.now() + offset);
  const res = await fetch(`${relay.url}${path}`, { method, headers: { ...(raw && { "Content-Type": "application/json" }), ...authHeaders(a) }, body: raw || undefined });
  return { status: res.status, json: (await res.json()) as Record<string, never> & { error?: { code: string } } };
}

async function newRoom(opts: { maxRounds?: number; ttlSeconds?: number } = {}) {
  const intent = await seller.publishIntent({ vertical: "api.inference", role: "seller", capabilityTags: ["llama"], spec, ttlSeconds: 3600 });
  const { room } = await buyer.openRoom({ intentId: intent.id, terms: withPrice(spec, "250"), mandateCommitment: await commit("buyer"), ...opts });
  return room.id;
}

describe("room state machine", () => {
  it("enforces turns, first-move commitments, fixed commitments and currency", async () => {
    const id = await newRoom();
    await expect(buyer.sendEvent(id, { type: "COUNTER", terms: withPrice(spec, "260") })).rejects.toMatchObject({ code: "not_your_turn" });
    await expect(buyer.sendEvent(id, { type: "ACCEPT" })).rejects.toMatchObject({ code: "not_your_turn" });
    await expect(seller.sendEvent(id, { type: "COUNTER", terms: withPrice(spec, "300") })).rejects.toMatchObject({ code: "mandate_commitment_required" });
    await expect(seller.sendEvent(id, { type: "COUNTER", terms: { ...spec, unitPriceAtomic: "300", currency: "EUR" }, mandateCommitment: await commit("seller") })).rejects.toMatchObject({ code: "currency_changed" });
    await expect(seller.sendEvent(id, { type: "COUNTER", terms: { ...spec, unitPriceAtomic: "3.5" }, mandateCommitment: await commit("seller") })).rejects.toMatchObject({ status: 422, code: "invalid_terms" });
    const c = await commit("seller");
    await seller.sendEvent(id, { type: "COUNTER", terms: withPrice(spec, "300"), mandateCommitment: c });
    await expect(buyer.sendEvent(id, { type: "COUNTER", terms: withPrice(spec, "280"), mandateCommitment: await commit("buyer") })).rejects.toMatchObject({ code: "commitment_changed" });
    await expect(seller.sendEvent(id, { type: "SIGN", signature: "x".repeat(86) })).rejects.toMatchObject({ code: "bad_transition" });
    await expect(seller.sendEvent(id, { type: "CLEAR", receipt: {}, signatures: { buyer: "a", seller: "b" } })).rejects.toMatchObject({ code: "bad_transition" });
  });

  it("caps counter-offers at maxRounds", async () => {
    const id = await newRoom({ maxRounds: 2 });
    await seller.sendEvent(id, { type: "COUNTER", terms: withPrice(spec, "320"), mandateCommitment: await commit("seller") });
    await buyer.sendEvent(id, { type: "COUNTER", terms: withPrice(spec, "270") });
    await expect(seller.sendEvent(id, { type: "COUNTER", terms: withPrice(spec, "300") })).rejects.toMatchObject({ code: "max_rounds" });
    const accepted = await seller.sendEvent(id, { type: "ACCEPT" });
    expect(accepted.room).toMatchObject({ status: "ACCEPTED", rounds: 2, accepted: { priceAtomic: "270" } });
  });

  it("rejects from either side, and closes the room for good", async () => {
    const id = await newRoom();
    const r = await buyer.sendEvent(id, { type: "REJECT" });
    expect(r.room.status).toBe("REJECTED");
    await expect(seller.sendEvent(id, { type: "ACCEPT", mandateCommitment: await commit("seller") })).rejects.toMatchObject({ code: "room_closed" });
  });

  it("records expiry as a relay event once the room's time is up, and refuses moves after it", async () => {
    const id = await newRoom({ ttlSeconds: 60 });
    offset = 61_000;
    try {
      const late = await call(sellerKey, "POST", `/v1/rooms/${id}/events`, { type: "ACCEPT", mandateCommitment: await commit("seller") });
      expect(late.status).toBe(409);
      const view = await call(buyerKey, "GET", `/v1/rooms/${id}`);
      const events = view.json.events as unknown as RoomEvent[];
      expect((view.json.room as unknown as { status: string }).status).toBe("EXPIRED");
      expect(events.at(-1)).toMatchObject({ type: "EXPIRE", by: "relay", auth: null });
      expect(await verifyTranscript(events)).toBeNull();
    } finally {
      offset = 0;
    }
  });

  it("refuses a room on your own intent, and unknown or expired intents", async () => {
    const intent = await seller.publishIntent({ vertical: "api.inference", role: "seller", capabilityTags: [], spec, ttlSeconds: 60 });
    await expect(seller.openRoom({ intentId: intent.id, terms: spec, mandateCommitment: await commit("seller") })).rejects.toMatchObject({ code: "own_intent" });
    await expect(buyer.openRoom({ intentId: "in_" + "0".repeat(24), terms: spec, mandateCommitment: await commit("buyer") })).rejects.toMatchObject({ status: 404 });
    offset = 61_000;
    try {
      const r = await call(buyerKey, "POST", "/v1/rooms", { intentId: intent.id, terms: spec, mandateCommitment: await commit("buyer") });
      expect(r.json.error?.code).toBe("intent_unavailable");
    } finally {
      offset = 0;
    }
    expect((await buyer.discoverIntents({ vertical: "api.inference" })).map((i) => i.id)).toContain(intent.id);
  });
});

describe("listing a caller's rooms", () => {
  it("shows an intent owner the rooms opened on its intents, and nobody else's", async () => {
    const id = await newRoom();
    const mine = await seller.listRooms({ status: ["PROPOSED"] });
    expect(mine.map((r) => r.id)).toContain(id);
    expect(mine.every((r) => r.status === "PROPOSED" && r.seller.pubkey === sellerKey.publicKey)).toBe(true);
    const stranger = new RelayTransport({ baseUrl: relay.url, key: await AgentKey.generate() });
    expect(await stranger.listRooms()).toEqual([]);
    expect((await call(sellerKey, "GET", "/v1/rooms?status=OPEN")).json.error?.code).toBe("bad_filter");
    expect((await fetch(`${relay.url}/v1/rooms`)).status).toBe(401);
  });

  it("records expiry while listing, so a dead room never shows as open", async () => {
    const id = await newRoom({ ttlSeconds: 60 });
    offset = 61_000;
    try {
      const r = await call(sellerKey, "GET", "/v1/rooms?status=PROPOSED,COUNTERED");
      expect((r.json.rooms as unknown as { id: string }[]).map((x) => x.id)).not.toContain(id);
      const all = await call(sellerKey, "GET", "/v1/rooms?status=EXPIRED");
      expect((all.json.rooms as unknown as { id: string }[]).map((x) => x.id)).toContain(id);
    } finally {
      offset = 0;
    }
  });
});

describe("transcript integrity", () => {
  it("detects any edit to a move: body, author, order or signature", async () => {
    const id = await newRoom();
    await seller.sendEvent(id, { type: "COUNTER", terms: withPrice(spec, "300"), mandateCommitment: await commit("seller") });
    const { events } = await buyer.getRoom(id);
    expect(await verifyTranscript(events)).toBeNull();
    const edited = structuredClone(events);
    (edited[1].body.terms as Record<string, unknown>).unitPriceAtomic = "299";
    expect(await verifyTranscript(edited)).toMatch(/hash mismatch/);
    const reauthored = structuredClone(events);
    reauthored[1].by = buyerKey.publicKey;
    expect(await verifyTranscript(reauthored)).not.toBeNull();
    expect(await verifyTranscript([events[1], events[0]])).toMatch(/out of sequence/);
    const resigned = structuredClone(events);
    resigned[0].auth!.signature = events[1].auth!.signature;
    expect(await verifyTranscript(resigned)).toMatch(/signature does not verify/);
  });
});

describe("subscriptions", () => {
  it("falls back to polling and still delivers each event once, in order", async () => {
    const id = await newRoom();
    const seen: number[] = [];
    const sub = buyer.subscribeRoom(id, (e) => seen.push(e.seq), { mode: "poll", pollMs: 50 });
    expect(sub.mode).toBe("poll");
    await seller.sendEvent(id, { type: "COUNTER", terms: withPrice(spec, "300"), mandateCommitment: await commit("seller") });
    await buyer.sendEvent(id, { type: "ACCEPT" });
    const until = Date.now() + 3000;
    while (seen.length < 3 && Date.now() < until) await new Promise((r) => setTimeout(r, 25));
    sub.close();
    expect(seen).toEqual([1, 2, 3]);
  });

  it("uses SSE when no WebSocket is available", async () => {
    const id = await newRoom();
    const noWs = new RelayTransport({ baseUrl: relay.url, key: buyerKey, WebSocket: null });
    const seen: number[] = [];
    const sub = noWs.subscribeRoom(id, (e) => seen.push(e.seq));
    expect(sub.mode).toBe("sse");
    const until = Date.now() + 3000;
    while (!seen.length && Date.now() < until) await new Promise((r) => setTimeout(r, 25));
    sub.close();
    expect(seen).toEqual([1]);
  });
});

describe("guardrails", () => {
  it("bounds bodies and rejects unknown fields and malformed input without echoing it", async () => {
    const big = await call(buyerKey, "POST", "/v1/agents", { displayName: "x".repeat(70_000) });
    expect(big.status).toBe(413);
    const extra = await call(buyerKey, "POST", "/v1/agents", { displayName: "ok", isAdmin: true });
    expect(extra.json.error?.code).toBe("unknown_field");
    const ctrl = await call(buyerKey, "POST", "/v1/agents", { displayName: "bad\u0007name" });
    expect(ctrl.json.error?.code).toBe("bad_profile");
    const res = await fetch(`${relay.url}/v1/receipts/<script>`);
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("<script>");
    expect((await fetch(`${relay.url}/v1/intents?vertical=compute.tpu`)).status).toBe(400);
    expect((await fetch(`${relay.url}/v1/agents/not-a-key/reputation`)).status).toBe(400);
  });

  it("never accepts a mandate in place of a commitment", async () => {
    const intent = await seller.publishIntent({ vertical: "api.inference", role: "seller", capabilityTags: [], spec, ttlSeconds: 3600 });
    const r = await call(buyerKey, "POST", "/v1/rooms", { intentId: intent.id, terms: spec, mandateCommitment: "912345" });
    expect(r.json.error?.code).toBe("bad_commitment");
    const r2 = await call(buyerKey, "POST", "/v1/rooms", { intentId: intent.id, terms: spec, mandateCommitment: await commit("buyer"), mandate: { limitAtomic: "400" } });
    expect(r2.json.error?.code).toBe("unknown_field");
  });
});

describe("replay protection stores", () => {
  it("memory: a nonce is single-use until its TTL passes", async () => {
    let t = 0;
    const m = new MemoryNonceStore(() => t);
    expect(await m.claim("k", 60)).toBe(true);
    expect(await m.claim("k", 60)).toBe(false);
    t = 61_000;
    expect(await m.claim("k", 60)).toBe(true);
  });

  it("Upstash: SET NX EX semantics, and fail closed when Redis errors", async () => {
    const seen = new Set<string>();
    const bodies: unknown[] = [];
    const fake: typeof fetch = async (_url, init) => {
      const cmd = JSON.parse(String(init?.body)) as string[];
      bodies.push(cmd);
      const fresh = !seen.has(cmd[1]);
      seen.add(cmd[1]);
      return Response.json({ result: fresh ? "OK" : null });
    };
    const u = new UpstashNonceStore("https://redis.example", "token", fake);
    expect(await u.claim("bloom:relay:nonce:a:b", 60)).toBe(true);
    expect(await u.claim("bloom:relay:nonce:a:b", 60)).toBe(false);
    expect(bodies[0]).toEqual(["SET", "bloom:relay:nonce:a:b", "1", "NX", "EX", "60"]);
    const down = new UpstashNonceStore("https://redis.example", "token", async () => new Response("down", { status: 500 }));
    await expect(down.claim("k", 60)).rejects.toThrow();
  });

  it("the relay refuses (503) when replay protection is down, and only claims nonces for valid signatures", async () => {
    const key = await AgentKey.generate();
    const a = await signRequest(key, "GET", "/v1/rooms/x");
    const get = (h: Record<string, string>) => (n: string) => h[n];
    const headers = authHeaders(a);
    const down = await authenticate({ method: "GET", target: "/v1/rooms/x", get: get(headers), rawBody: new Uint8Array(0), nonces: { kind: "redis", claim: async () => Promise.reject(new Error("down")) }, now: Date.now() });
    expect(down).toMatchObject({ ok: false, status: 503, code: "auth_unavailable" });
    let claims = 0;
    const counting = { kind: "memory" as const, claim: async () => (claims++, true) };
    const forged = await authenticate({ method: "GET", target: "/v1/rooms/y", get: get(headers), rawBody: new Uint8Array(0), nonces: counting, now: Date.now() });
    expect(forged).toMatchObject({ ok: false, code: "auth_signature" });
    expect(claims).toBe(0);
  });
});
