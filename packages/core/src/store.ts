import { kv, kvConfig } from "./platform/kv";
import { DEFAULT_STANDING_MANDATE, InitiatorMandateSchema, type InitiatorMandate } from "./types";
import type { EnclaveRecord } from "./enclave";

/**
 * Exchange persistence. With Vercel KV / Upstash configured every instance shares tasks, idempotency claims, the
 * settlement ledger, the traffic feed and the standing mandate; without it each instance keeps its own in memory
 * (fine for development and a single long-lived server). KV errors fall back to memory rather than failing a run.
 */

const TASK_TTL = 7 * 86_400;
const IDEM_TTL = 86_400;
const P = "bloom:xch";

type Entry = { value: string; expires: number };
// On globalThis: Next bundles each route separately, and they must share one in-process fallback store.
const shared = globalThis as typeof globalThis & { __bloomExchangeStore?: { memory: Map<string, Entry>; lists: Map<string, string[]> } };
shared.__bloomExchangeStore ??= { memory: new Map(), lists: new Map() };
const { memory, lists } = shared.__bloomExchangeStore;

function memGet(key: string): string | null {
  const e = memory.get(key);
  if (!e) return null;
  if (e.expires < Date.now()) {
    memory.delete(key);
    return null;
  }
  return e.value;
}
function memSet(key: string, value: string, ttl: number) {
  memory.set(key, { value, expires: Date.now() + ttl * 1000 });
  if (memory.size > 5_000) memory.delete(memory.keys().next().value as string);
}

async function run(commands: (string | number)[][]): Promise<unknown[] | null> {
  const cfg = kvConfig();
  if (!cfg) return null;
  try {
    return await kv(cfg, commands);
  } catch {
    return null;
  }
}

export async function loadTask(id: string): Promise<EnclaveRecord | null> {
  if (!/^xch_[\w-]{10,40}$/.test(id)) return null;
  const r = await run([["GET", `${P}:task:${id}`]]);
  const raw = (r?.[0] as string | null | undefined) ?? memGet(`${P}:task:${id}`);
  return raw ? (JSON.parse(raw) as EnclaveRecord) : null;
}

export async function saveTask(rec: EnclaveRecord): Promise<void> {
  const value = JSON.stringify(rec);
  memSet(`${P}:task:${rec.id}`, value, TASK_TTL);
  await run([["SET", `${P}:task:${rec.id}`, value, "EX", TASK_TTL]]);
}

/** Cancellation is a separate flag, so a running enclave's own saves can never overwrite it. */
export async function requestCancel(id: string) {
  memSet(`${P}:cancel:${id}`, "1", TASK_TTL);
  await run([["SET", `${P}:cancel:${id}`, "1", "EX", TASK_TTL]]);
}

export async function cancelRequested(id: string): Promise<boolean> {
  if (memGet(`${P}:cancel:${id}`)) return true;
  const r = await run([["GET", `${P}:cancel:${id}`]]);
  return Boolean(r?.[0]);
}

export type IdemClaim = { taskId: string; digest: string };

/** Atomically claims an idempotency key for a new task. Returns the existing claim when the key was already used. */
export async function claimIdempotency(scope: string, claim: IdemClaim): Promise<{ claimed: true } | { claimed: false; existing: IdemClaim }> {
  const key = `${P}:idem:${scope}`;
  const value = JSON.stringify(claim);
  const r = await run([["SET", key, value, "NX", "EX", IDEM_TTL], ["GET", key]]);
  if (r) {
    if (r[0] === "OK") {
      memSet(key, value, IDEM_TTL);
      return { claimed: true };
    }
    return { claimed: false, existing: JSON.parse(String(r[1])) as IdemClaim };
  }
  const prior = memGet(key);
  if (prior) return { claimed: false, existing: JSON.parse(prior) as IdemClaim };
  memSet(key, value, IDEM_TTL);
  return { claimed: true };
}

async function push(list: string, value: string, cap: number) {
  const key = `${P}:${list}`;
  const l = lists.get(key) ?? [];
  l.unshift(value);
  lists.set(key, l.slice(0, cap));
  await run([["LPUSH", key, value], ["LTRIM", key, 0, cap - 1]]);
}

async function range(list: string, limit: number): Promise<string[]> {
  const key = `${P}:${list}`;
  const r = await run([["LRANGE", key, 0, limit - 1]]);
  return Array.isArray(r?.[0]) ? (r[0] as string[]) : (lists.get(key) ?? []).slice(0, limit);
}

export async function addToLedger(taskId: string) {
  await push("ledger", taskId, 200);
}

export async function ledgerIds(limit = 60): Promise<string[]> {
  return [...new Set(await range("ledger", limit))];
}

export type TrafficEvent = { at: string; taskId: string; kind: "handshake" | "blocked" | "round" | "settled" | "exception" | "rejected"; peer: string; detail: string };

export async function pushTraffic(e: TrafficEvent) {
  await push("traffic", JSON.stringify(e), 120);
}

export async function listTraffic(limit = 60): Promise<TrafficEvent[]> {
  return (await range("traffic", limit)).map((s) => JSON.parse(s) as TrafficEvent);
}

/**
 * Shield's audit ledger: one entry per screened payload that carried threats, each hash-chained to the previous
 * entry so a deleted or edited entry is detectable. Concurrent writers on different instances may fork the chain
 * briefly; every entry still carries its own content hash.
 */
export type AuditEntry = { at: string; taskId: string; peer: string; verdict: string; vectors: Record<string, number>; prevHash: string; hash: string };

export async function pushAudit(e: Omit<AuditEntry, "prevHash" | "hash">, sha256: (s: string) => string): Promise<AuditEntry> {
  const head = (await range("audit", 1))[0];
  const prevHash = head ? (JSON.parse(head) as AuditEntry).hash : "0".repeat(64);
  const entry: AuditEntry = { ...e, prevHash, hash: sha256(JSON.stringify({ ...e, prevHash })) };
  await push("audit", JSON.stringify(entry), 500);
  return entry;
}

export async function listAudit(limit = 60): Promise<AuditEntry[]> {
  return (await range("audit", limit)).map((s) => JSON.parse(s) as AuditEntry);
}

/** Omni-protocol intents, scoped to the caller that injected them (never a shared feed of user text). */
export async function pushIntent(owner: string, node: unknown) {
  await push(`intents:${owner}`, JSON.stringify(node), 60);
}

export async function listIntents<T>(owner: string, limit = 60): Promise<T[]> {
  return (await range(`intents:${owner}`, limit)).map((s) => JSON.parse(s) as T);
}

/** The global pulse ring: numbers, domains and protocol ids only, so aggregates can be public. */
export async function pushPulse(sample: unknown) {
  await push("pulse", JSON.stringify(sample), 500);
}

export async function listPulse<T>(limit = 500): Promise<T[]> {
  return (await range("pulse", limit)).map((s) => JSON.parse(s) as T);
}

export async function getStandingMandate(): Promise<{ mandate: InitiatorMandate; configured: boolean }> {
  const r = await run([["GET", `${P}:mandate:standing`]]);
  const raw = (r?.[0] as string | null | undefined) ?? memGet(`${P}:mandate:standing`);
  if (raw) {
    const parsed = InitiatorMandateSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return { mandate: parsed.data, configured: true };
  }
  return { mandate: DEFAULT_STANDING_MANDATE, configured: false };
}

export async function setStandingMandate(m: InitiatorMandate) {
  const value = JSON.stringify(m);
  memSet(`${P}:mandate:standing`, value, 10 * 365 * 86_400);
  await run([["SET", `${P}:mandate:standing`, value]]);
}

/** Out-of-bounds negotiations per identity in the current hour: Shield's mandate-probing signal. */
export async function probeCount(identity: string): Promise<number> {
  const key = `${P}:probe:${identity}:${Math.floor(Date.now() / 3_600_000)}`;
  const r = await run([["GET", key]]);
  return Number((r?.[0] as string | null | undefined) ?? memGet(key) ?? 0);
}

export async function recordProbe(identity: string) {
  const key = `${P}:probe:${identity}:${Math.floor(Date.now() / 3_600_000)}`;
  memSet(key, String(Number(memGet(key) ?? 0) + 1), 7200);
  await run([["INCR", key], ["EXPIRE", key, 7200]]);
}
