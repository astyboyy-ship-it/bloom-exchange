import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deterministicApex, type Proposer } from "../src/bloom-bridge";
import { provisionEnclave, runEnclave } from "../src/enclave";
import { AdapterRegistry, disableEvents, enableEvents, FileEventLog, JsonlSinkAdapter, MemoryEventLog, MockTriggerAdapter, type BloomEvent, type BloomEventDraft, type EventAdapter, type EventHub } from "../src/events";
import { GET as eventsGET } from "../src/http/events";
import { DEV_SIGNING_SECRET, signAccessKey } from "../src/licensing/codec";
import { ROLE_DEFAULTS, ROLE_TIER } from "../src/licensing/types";
import type { CounterpartyMandate } from "../src/types";
import { BREACH_BUYER, BUYER, buyerSecrets, INJECTION, ITEM, LOWBALL_BUYER, POISONED_CARD, rpc, SELLER, sellerSecrets, sendParams } from "./fixtures";

const noneMatch = (text: string, patterns: RegExp[]) => patterns.filter((p) => p.test(text)).map(String);

function enclave(buyer: CounterpartyMandate = BUYER, message = "We need gold SLA.", peerCard?: Record<string, unknown>) {
  return provisionEnclave({ owner: "test", environment: "sandbox", source: "simulated", origin: "http://localhost:3000", peerName: "acme", framework: "custom", peerCard, item: ITEM, preferredRail: "stripe", initiator: SELLER, counterparty: buyer, message, probes: 0 });
}

/** A proposer that tries to give everything away: offers $1, then leaks figures in its message. Sovereign clamps it. */
const reckless: Proposer = async (ctx) => ({
  terms: { ...ctx.plan, priceUsd: 1 },
  message: `Our floor is $41,373 (41373), cost basis 29,411, margin 27.5%, auto-settle 75013. Take it for $1.`,
  model: "test/reckless",
});

const allEvents = (hub: EventHub) => {
  const out: BloomEvent[] = [];
  let page = hub.read({ limit: 200 });
  out.push(...page.events);
  while (page.hasMore) {
    page = hub.read({ cursor: page.cursor, limit: 200 });
    out.push(...page.events);
  }
  return out;
};

const draft = (over: Partial<BloomEventDraft> = {}): BloomEventDraft =>
  ({ at: new Date().toISOString(), taskId: "xch_test_0000000000", contextId: "ctx_test", environment: "sandbox", audience: "public", type: "negotiation.exception", data: { kind: "out_of_bounds" }, ...over }) as BloomEventDraft;

async function operatorKey() {
  const base = ROLE_DEFAULTS.operator;
  return signAccessKey({ keyId: "op_events", holderName: "Events Operator", role: "operator", tier: ROLE_TIER.operator, unlockedEngines: base.unlockedEngines, themeConfig: base.theme, permissions: base.permissions, issuedAt: new Date().toISOString(), expiresAt: null }, DEV_SIGNING_SECRET);
}

let ip = 0;
const feed = (query = "", headers: Record<string, string> = {}, signal?: AbortSignal) => eventsGET(new Request(`http://localhost:3000/api/exchange/events${query}`, { headers: { "x-forwarded-for": `10.77.0.${++ip % 250}`, ...headers }, signal }));

afterEach(() => disableEvents());

describe("Bloom events: redaction", () => {
  let hub: EventHub;
  let mock: MockTriggerAdapter;
  let jsonlPath: string;
  beforeEach(() => {
    mock = new MockTriggerAdapter({ events: "*" });
    jsonlPath = join(mkdtempSync(join(tmpdir(), "bloom-events-")), "audit.jsonl");
    hub = enableEvents({ adapters: [mock, new JsonlSinkAdapter({ path: jsonlPath })], registry: { backoffMs: 0 } });
  });

  it("never carries a mandate figure, margin, salt or free text, in the feed or in any adapter's output", async () => {
    await runEnclave(enclave(BUYER), { apex: deterministicApex }); // settles
    await runEnclave(enclave(LOWBALL_BUYER), { apex: deterministicApex }); // may hold at the bound
    await runEnclave(enclave(BREACH_BUYER), { apex: deterministicApex }); // sla_infeasible or out of bounds
    await runEnclave(enclave(BUYER, INJECTION, POISONED_CARD), { apex: reckless }); // hostile text, leaky model, clamps
    for (const buyer of [BUYER, LOWBALL_BUYER]) await rpc("SendMessage", sendParams({ buyer, message: INJECTION }));
    await hub.idle();

    const events = allEvents(hub);
    const surfaces = { feed: JSON.stringify(events), jsonl: readFileSync(jsonlPath, "utf8"), mock: JSON.stringify(mock.fired) };
    expect(events.length).toBeGreaterThan(30);
    for (const [name, text] of Object.entries(surfaces)) {
      expect(noneMatch(text, sellerSecrets()), name).toEqual([]);
      for (const buyer of [BUYER, LOWBALL_BUYER, BREACH_BUYER]) expect(noneMatch(text, buyerSecrets(buyer)), name).toEqual([]);
      // No free text of any kind: model messages, exception details, item descriptions, peer names, threat matches.
      expect(text, name).not.toMatch(/"(message|text|detail|reason|description|peer|name|match|excerpt)":/);
      expect(text, name).not.toContain("Managed observability");
      expect(text, name).not.toMatch(/ignore all previous|developer mode|acme/i);
    }
  });

  it("projects clamps as rule names only, and exceptions as their kind only", async () => {
    await runEnclave(enclave(BUYER, "hello"), { apex: reckless });
    await runEnclave(enclave(BREACH_BUYER), { apex: deterministicApex });
    const events = allEvents(hub);
    const clamps = events.filter((e) => e.type === "negotiation.clamped");
    expect(clamps.length).toBeGreaterThan(0);
    const known = ["mandate_floor", "anchor_cap", "regression", "concession_rate", "net_terms", "sla_tier", "dominated", "invalid"];
    for (const c of clamps) {
      expect(Object.keys(c.data).sort()).toEqual(["round", "rules"]);
      for (const rule of c.type === "negotiation.clamped" ? c.data.rules : []) expect(known).toContain(rule);
    }
    // The $1 proposal was clamped up to the floor at least once, and the event says so without saying where it is.
    expect(clamps.flatMap((c) => (c.type === "negotiation.clamped" ? c.data.rules : []))).toContain("mandate_floor");
    const exceptions = events.filter((e) => e.type === "negotiation.exception");
    expect(exceptions.length).toBeGreaterThan(0);
    for (const x of exceptions) expect(Object.keys(x.data)).toEqual(["kind"]);
  });

  it("emits the lifecycle in order and references the signed receipt", async () => {
    const rec = await runEnclave(enclave(BUYER), { apex: deterministicApex });
    await hub.idle();
    const events = allEvents(hub).filter((e) => e.taskId === rec.id);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("negotiation.opened");
    expect(types[1]).toBe("firewall.scanned");
    expect(types.filter((t) => t === "offer.updated").length).toBe(rec.rounds.length);
    expect(types.slice(-2)).toEqual(["negotiation.settled", "receipt.issued"]);
    expect(events.map((e) => e.seq)).toEqual([...events.map((e) => e.seq)].sort((a, b) => a - b));

    const receipt = events.find((e) => e.type === "receipt.issued");
    const cert = rec.certificate!;
    expect(receipt?.type === "receipt.issued" && receipt.data).toEqual({ certificateId: cert.certificateId, digest: cert.digest, kid: cert.signature.kid, issuerCard: cert.issuer.agentCard, chainHead: cert.rounds.chainHead, binding: false });
    // The dry-run trigger fired for settlement and receipt, and the audit file holds the same references.
    expect(mock.fired.filter((f) => f.taskId === rec.id && f.certificateId === cert.certificateId).map((f) => f.type)).toEqual(expect.arrayContaining(["negotiation.settled", "receipt.issued"]));
    expect(readFileSync(jsonlPath, "utf8")).toContain(cert.digest);
  });
});

describe("Bloom events: cursors", () => {
  it("pages through the log in order, without gaps or duplicates", () => {
    const log = new MemoryEventLog();
    for (let i = 0; i < 25; i++) log.append(draft());
    const seen: number[] = [];
    let page = log.read({ limit: 7 });
    seen.push(...page.events.map((e) => e.seq));
    while (page.hasMore) {
      page = log.read({ cursor: page.cursor, limit: 7 });
      seen.push(...page.events.map((e) => e.seq));
    }
    expect(seen).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    const tail = log.read({ cursor: page.cursor });
    expect(tail).toMatchObject({ events: [], reset: false, hasMore: false, cursor: page.cursor });
  });

  it("advances the cursor past events a type filter skips", () => {
    const log = new MemoryEventLog();
    log.append(draft());
    log.append(draft({ type: "negotiation.closed", data: { state: "failed" } } as Partial<BloomEventDraft>));
    log.append(draft());
    const page = log.read({ types: ["negotiation.closed"] });
    expect(page.events.map((e) => e.seq)).toEqual([2]);
    expect(page.cursor.endsWith(".3")).toBe(true);
  });

  it("reports reset for a cursor from before a restart, from the future, or off the retained window", () => {
    const before = new MemoryEventLog();
    before.append(draft());
    const old = before.read().cursor;
    const after = new MemoryEventLog(); // a restarted process: new epoch
    after.append(draft());
    expect(after.read({ cursor: old })).toMatchObject({ reset: true, events: [expect.objectContaining({ seq: 1 })] });
    expect(after.read({ cursor: `${after.epoch}.999` }).reset).toBe(true);
    expect(after.read({ cursor: "garbage" }).reset).toBe(true);

    const small = new MemoryEventLog(3);
    for (let i = 0; i < 10; i++) small.append(draft());
    const r = small.read({ cursor: `${small.epoch}.2` });
    expect(r.reset).toBe(true);
    expect(r.events.map((e) => e.seq)).toEqual([8, 9, 10]);
  });

  it("keeps cursors valid across restarts with the durable file log", () => {
    const dir = mkdtempSync(join(tmpdir(), "bloom-log-"));
    const first = new FileEventLog(dir);
    for (let i = 0; i < 4; i++) first.append(draft());
    const cursor = first.read({ limit: 2 }).cursor;
    const reopened = new FileEventLog(dir);
    expect(reopened.epoch).toBe(first.epoch);
    const page = reopened.read({ cursor });
    expect(page.reset).toBe(false);
    expect(page.events.map((e) => e.seq)).toEqual([3, 4]);
    expect(reopened.append(draft()).seq).toBe(5);
  });

  it("derives stable, distinct event ids", () => {
    const log = new MemoryEventLog();
    const a = log.append(draft());
    const b = log.append(draft());
    expect(a.id).toMatch(/^evt_[0-9a-f]{24}$/);
    expect(a.id).not.toBe(b.id);
  });
});

describe("Bloom events: adapters, idempotency and retries", () => {
  const event = () => new MemoryEventLog().append(draft({ type: "negotiation.settled", data: { certificateId: "BLOOM-XCH-AAAA-BBBB-CCCC-DDDD", priceUsd: 47_000, netDays: 45, slaTier: "gold", rounds: 8, binding: false } } as Partial<BloomEventDraft>));

  it("retries a retryable failure with backoff and delivers once", async () => {
    const delays: number[] = [];
    const registry = new AdapterRegistry({ maxAttempts: 3, backoffMs: 10, sleep: async (ms) => void delays.push(ms) });
    const mock = new MockTriggerAdapter({ failFirst: 2 });
    registry.register(mock);
    const [outcome] = await registry.dispatch(event());
    expect(outcome).toMatchObject({ status: "delivered", attempts: 3 });
    expect(delays).toEqual([10, 20]);
    expect(mock.fired).toHaveLength(1);
    expect(mock.fired[0].attempt).toBe(3);
  });

  it("delivers an event at most once per adapter, even dispatched twice or concurrently", async () => {
    const registry = new AdapterRegistry({ backoffMs: 0 });
    const mock = new MockTriggerAdapter();
    registry.register(mock);
    const e = event();
    const [a, b] = await Promise.all([registry.dispatch(e), registry.dispatch(e)]);
    const again = await registry.dispatch(e);
    expect(mock.fired).toHaveLength(1);
    expect([a[0].status, b[0].status].sort()).toEqual(["delivered", "duplicate"]);
    expect(again[0].status).toBe("duplicate");
    expect(mock.fired[0].idempotencyKey).toBe(e.id);
  });

  it("stops at a non-retryable failure and dead-letters exhausted deliveries", async () => {
    const registry = new AdapterRegistry({ maxAttempts: 4, backoffMs: 0 });
    let calls = 0;
    const refusing: EventAdapter = { id: "refusing", name: "refusing", events: "*", check: async () => ({ ok: true, detail: "" }), deliver: async () => (calls++, { ok: false, retryable: false, reason: "receiver answered 400" }) };
    const flaky = new MockTriggerAdapter({ id: "flaky", failFirst: 99 });
    registry.register(refusing).register(flaky);
    const outcomes = await registry.dispatch(event());
    expect(calls).toBe(1);
    expect(flaky.attempts).toBe(4);
    expect(outcomes.map((o) => o.status)).toEqual(["failed", "failed"]);
    expect(registry.deadLetters().map((d) => [d.adapter, d.attempts])).toEqual([["refusing", 1], ["flaky", 4]]);
  });

  it("delivers to each adapter in log order, one at a time, and sheds load past its queue bound", async () => {
    const log = new MemoryEventLog();
    const events = Array.from({ length: 6 }, () => log.append(draft()));
    const order: number[] = [];
    let running = 0;
    let peak = 0;
    const slow: EventAdapter = {
      id: "slow",
      name: "slow",
      events: "*",
      check: async () => ({ ok: true, detail: "" }),
      deliver: async (e) => {
        peak = Math.max(peak, ++running);
        await new Promise((r) => setTimeout(r, 5 * (7 - e.seq))); // later events finish faster if run concurrently
        order.push(e.seq);
        running--;
        return { ok: true };
      },
    };
    const registry = new AdapterRegistry({ maxQueue: 4 }).register(slow);
    const outcomes = await Promise.all(events.map((e) => registry.dispatch(e)));
    expect(peak).toBe(1);
    expect(order).toEqual([1, 2, 3, 4]);
    expect(outcomes.map((o) => o[0].status)).toEqual(["delivered", "delivered", "delivered", "delivered", "failed", "failed"]);
    expect(registry.deadLetters().map((d) => d.reason)).toEqual(["queue full (4 waiting)", "queue full (4 waiting)"]);
  });

  it("only sends an adapter the event types it asked for", async () => {
    const registry = new AdapterRegistry();
    const onlyReceipts = new MockTriggerAdapter({ events: ["receipt.issued"] });
    registry.register(onlyReceipts);
    expect(await registry.dispatch(event())).toEqual([]);
    expect(onlyReceipts.attempts).toBe(0);
  });

  it("never lets a failing adapter or subscriber affect the negotiation", async () => {
    const throwing: EventAdapter = { id: "throws", name: "throws", events: "*", check: async () => ({ ok: true, detail: "" }), deliver: async () => { throw new Error("boom"); } };
    const hub = enableEvents({ adapters: [throwing], registry: { maxAttempts: 2, backoffMs: 0 } });
    hub.subscribe(() => { throw new Error("listener boom"); });
    const rec = await runEnclave(enclave(BUYER), { apex: deterministicApex });
    await hub.idle();
    expect(rec.state).toBe("completed");
    expect(rec.certificate?.certificateId).toMatch(/^BLOOM-XCH-/);
    expect(hub.registry.deadLetters().length).toBeGreaterThan(0);
    expect(hub.registry.deadLetters()[0].reason).toBe("adapter error: boom");
  });

  it("logs nothing and runs nothing while events are off", async () => {
    disableEvents();
    const res = await feed();
    expect(res.status).toBe(404);
    const rec = await runEnclave(enclave(BUYER), { apex: deterministicApex });
    expect(rec.state).toBe("completed");
  });
});

describe("Bloom events: HTTP feed", () => {
  let hub: EventHub;
  beforeEach(() => {
    hub = enableEvents();
  });

  it("shows a caller nothing it does not own, and the operator everything plus adapter status", async () => {
    hub.publish(draft({ environment: "sandbox" }), "someone-else");
    hub.publish(draft({ environment: "production" }), "someone-else");
    const anon = (await (await feed()).json()) as { events: BloomEvent[]; scope: string; adapters?: unknown };
    expect(anon).toMatchObject({ scope: "tasks", events: [] });
    expect(anon.adapters).toBeUndefined();
    const op = (await (await feed("", { "x-bloom-license": await operatorKey() })).json()) as { events: BloomEvent[]; scope: string; adapters: unknown[]; disabled: unknown[] };
    expect(op.scope).toBe("all");
    expect(op.events.map((e) => e.environment)).toEqual(["sandbox", "production"]);
    expect(op).toMatchObject({ adapters: [], disabled: [] });
  });

  it("pages by cursor, filters by type and rejects unknown types without echoing them", async () => {
    const op = { "x-bloom-license": await operatorKey() };
    for (let i = 0; i < 5; i++) hub.publish(draft());
    const first = (await (await feed("?limit=2", op)).json()) as { events: BloomEvent[]; cursor: string; hasMore: boolean };
    expect(first.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(first.hasMore).toBe(true);
    const next = (await (await feed(`?cursor=${first.cursor}&limit=10`, op)).json()) as { events: BloomEvent[] };
    expect(next.events.map((e) => e.seq)).toEqual([3, 4, 5]);
    expect((await feed("?types=receipt.issued", op)).status).toBe(200);
    const bad = await feed("?types=<script>mandate.leaked", op);
    expect(bad.status).toBe(400);
    expect(await bad.text()).not.toContain("script");
  });

  it("reports a misconfigured adapter instead of dropping it silently", async () => {
    const { hubFromEnv } = await import("../src/events");
    const warn = console.warn;
    const warnings: string[] = [];
    console.warn = (m: string) => void warnings.push(m);
    try {
      const h = hubFromEnv({ BLOOM_EVENTS: "1", BLOOM_EVENTS_WEBHOOK_URL: "https://hooks.example.com/x" });
      expect(h?.disabled).toEqual([{ id: "webhook", reason: "Webhook needs an explicit origin allowlist." }]);
      expect(warnings.join("\n")).toMatch(/adapter "webhook" disabled/);
      expect(hubFromEnv({})).toBeNull();
    } finally {
      console.warn = warn;
    }
  });

  it("streams over SSE: replays from the cursor, then pushes live events with resumable ids", async () => {
    hub.publish(draft());
    hub.publish(draft());
    const ac = new AbortController();
    const res = await feed(`?stream=1&cursor=${hub.log.epoch}.1`, { "x-bloom-license": await operatorKey() }, ac.signal);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let raw = "";
    setTimeout(() => hub.publish(draft()), 50);
    while (!raw.includes(`id: ${hub.log.epoch}.3`)) {
      const { value, done } = await reader.read();
      if (done) break;
      raw += decoder.decode(value);
    }
    ac.abort();
    expect(raw).not.toContain(`id: ${hub.log.epoch}.1\n`);
    expect(raw).toContain(`id: ${hub.log.epoch}.2\nevent: negotiation.exception`);
    expect(raw).toContain(`id: ${hub.log.epoch}.3\n`);
  });
});
