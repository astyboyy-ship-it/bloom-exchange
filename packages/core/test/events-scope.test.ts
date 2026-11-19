import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deterministicApex, type Proposer } from "../src/bloom-bridge";
import { provisionEnclave, runEnclave } from "../src/enclave";
import { disableEvents, enableEvents, type BloomEvent } from "../src/events";
import { callerFor } from "../src/gateway";
import { POST as a2a } from "../src/http/a2a";
import { GET as eventsGET } from "../src/http/events";
import { GET as streamGET } from "../src/http/stream";
import { DEV_SIGNING_SECRET, signAccessKey } from "../src/licensing/codec";
import { ROLE_DEFAULTS, ROLE_TIER, type KeyRole } from "../src/licensing/types";
import type { Environment } from "../src/types";
import { BUYER, ITEM, rpcRequest, SELLER, sellerSecrets, sendParams } from "./fixtures";

/**
 * Who may read which events. The feed enumerates task ids, so it must never hand out an id the caller does not
 * already hold (a sandbox id unlocks GetTask, resume and the sandbox operator stream), and it must not show a
 * production counterparty the operator-side facts (which round Sovereign clamped to the floor) that A2A keeps
 * private. Anonymous identity (client IP) is not stable enough to grant anything on its own.
 */
const noneMatch = (text: string, patterns: RegExp[]) => patterns.filter((p) => p.test(text)).map(String);
const as = (ip: string, extra: Record<string, string> = {}) => ({ "x-forwarded-for": ip, ...extra });
const feed = async (headers: Record<string, string>, query = "") => (await (await eventsGET(new Request(`http://localhost:3000/api/exchange/events?limit=200${query}`, { headers }))).json()) as { events: BloomEvent[]; scope: string };

async function key(role: KeyRole, keyId: string) {
  const base = ROLE_DEFAULTS[role];
  return signAccessKey({ keyId, holderName: keyId, role, tier: ROLE_TIER[role], unlockedEngines: base.unlockedEngines, themeConfig: base.theme, permissions: base.permissions, issuedAt: new Date().toISOString(), expiresAt: null }, DEV_SIGNING_SECRET);
}

/** Pushes every proposal to $1, so Sovereign must clamp it up to the floor. */
const reckless: Proposer = async (ctx) => ({ terms: { ...ctx.plan, priceUsd: 1 }, message: "ok", model: "test/reckless" });
const enclaveFor = (owner: string, environment: Environment) => provisionEnclave({ owner, environment, source: "simulated", origin: "http://localhost:3000", peerName: "acme", framework: "custom", item: ITEM, preferredRail: "stripe", initiator: SELLER, counterparty: BUYER, message: "hi", probes: 0 });

beforeEach(() => {
  enableEvents();
});
afterEach(() => disableEvents());

describe("Bloom events: who sees what", () => {
  it("never lets one anonymous caller enumerate another's sandbox tasks (and from there its operator stream)", async () => {
    // Alice runs a private sandbox with her own provider mandate.
    const res = await a2a(rpcRequest({ jsonrpc: "2.0", id: 1, method: "SendMessage", params: sendParams({ seller: SELLER }) }, as("203.0.113.10")));
    const aliceTask = ((await res.json()) as { result: { id: string } }).result.id;
    // Alice reads her events by presenting the id she was given, as GetTask would let her.
    expect((await feed(as("203.0.113.10"), `&taskId=${aliceTask}`)).events.some((e) => e.taskId === aliceTask)).toBe(true);
    // Without the id, neither she nor anyone else gets a list: an anonymous IP is not an identity.
    expect((await feed(as("203.0.113.10"))).events).toEqual([]);
    expect((await feed(as("198.51.100.66"))).events).toEqual([]);

    // (What a leaked id would unlock: the sandbox operator stream, which carries Alice's provider figures.)
    const op = await streamGET(new Request(`http://localhost:3000/api/exchange/stream?taskId=${aliceTask}&view=operator`, { headers: as("198.51.100.66") }));
    expect(noneMatch(await op.text(), sellerSecrets()).length).toBeGreaterThan(0);
  });

  it("gives a key holder its own tasks, and never a production counterparty the operator-side events", async () => {
    const buyerKey = await key("enterprise", "ent_buyer");
    const buyer = await callerFor(new Request("http://localhost:3000/", { headers: { "x-bloom-license": buyerKey } }));
    expect(buyer.licensed).toBe(true);
    const rec = enclaveFor(buyer.owner, "production");
    await runEnclave(rec, { apex: reckless });
    await runEnclave(enclaveFor("someone-else", "production"), { apex: deterministicApex });

    const mine = await feed({ "x-bloom-license": buyerKey });
    expect(mine.scope).toBe("own");
    expect(new Set(mine.events.map((e) => e.taskId))).toEqual(new Set([rec.id]));
    const types = new Set(mine.events.map((e) => e.type));
    expect(types.has("offer.updated")).toBe(true);
    expect(types.has("negotiation.clamped")).toBe(false); // "round 4 was clamped to the floor" + its price ≈ the floor
    expect(mine.events.every((e) => e.audience === "public")).toBe(true);
    // Presenting someone else's production task id grants nothing.
    const other = (await feed({ "x-bloom-license": await key("operator", "op_scope") })).events.find((e) => e.taskId !== rec.id)!;
    expect((await feed(as("192.0.2.77"), `&taskId=${other.taskId}`)).events).toEqual([]);

    const operator = await feed({ "x-bloom-license": await key("operator", "op_scope") });
    expect(operator.scope).toBe("all");
    expect(operator.events.some((e) => e.taskId === rec.id && e.type === "negotiation.clamped")).toBe(true);
  });

  it("narrows to presented task ids for every reader; ids never widen and never union with owned tasks", async () => {
    const ownerKey = await key("enterprise", "ent_narrow");
    const owner = await callerFor(new Request("http://localhost:3000/", { headers: { "x-bloom-license": ownerKey } }));
    const mineProd = await runEnclave(enclaveFor(owner.owner, "production"), { apex: deterministicApex });
    const sandbox = await runEnclave(enclaveFor("anyone", "sandbox"), { apex: deterministicApex });
    const narrowed = await feed({ "x-bloom-license": ownerKey }, `&taskId=${sandbox.id}`);
    expect(new Set(narrowed.events.map((e) => e.taskId))).toEqual(new Set([sandbox.id]));
    const op = await feed({ "x-bloom-license": await key("operator", "op_narrow") }, `&taskId=${mineProd.id}`);
    expect(new Set(op.events.map((e) => e.taskId))).toEqual(new Set([mineProd.id]));
  });

  it("gives feed reads their own budget, so polling never starves the same caller's negotiations", async () => {
    const me = as("192.0.2.200");
    for (let i = 0; i < 30; i++) expect((await eventsGET(new Request("http://localhost:3000/api/exchange/events", { headers: me }))).status).toBe(200);
    const res = await a2a(new Request("http://localhost:3000/api/exchange/a2a", { method: "POST", headers: { "Content-Type": "application/json", ...me }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "SendMessage", params: sendParams() }) }));
    expect(res.status).toBe(200);
  });

  it("shows a sandbox task's operator-side events to whoever holds its id, as the A2A sandbox stream does", async () => {
    const rec = enclaveFor("anyone", "sandbox");
    await runEnclave(rec, { apex: reckless });
    await runEnclave(enclaveFor("someone-else", "sandbox"), { apex: deterministicApex });
    const mine = await feed(as("192.0.2.55"), `&taskId=${rec.id}`);
    expect(mine.scope).toBe("tasks");
    expect(mine.events.some((e) => e.type === "negotiation.clamped")).toBe(true);
    expect(mine.events.every((e) => e.taskId === rec.id)).toBe(true);
  });
});
