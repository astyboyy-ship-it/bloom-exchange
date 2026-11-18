import type { RunEvent } from "../platform/events";
import { MODELS } from "../platform/models";
import { kv, kvConfig } from "../platform/kv";

/**
 * Server-side spend guardrail for live runs on the SERVER's provider key (runs on an operator's own key cost the
 * server nothing and are not metered). Two daily caps, in USD, reset at 00:00 UTC:
 *   BLOOM_DAILY_SPEND_CAP_USD      whole deployment   (default 20)
 *   BLOOM_KEY_DAILY_SPEND_CAP_USD  per license key    (default 5)
 * A run is admitted live only while both totals are under their caps; otherwise it runs in simulation. Cost is
 * metered from each finished run's real token usage at the model's list price (models.ts). Totals live in
 * Vercel KV when configured (shared by every instance) and in per-instance memory otherwise. Because a run is
 * admitted before its cost is known, concurrent runs can overshoot a cap by at most the runs already in flight.
 */

const capUsd = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};
export const DAILY_CAP_USD = () => capUsd("BLOOM_DAILY_SPEND_CAP_USD", 20);
export const KEY_DAILY_CAP_USD = () => capUsd("BLOOM_KEY_DAILY_SPEND_CAP_USD", 5);

const day = () => new Date().toISOString().slice(0, 10);
const keys = (identity: string) => {
  const d = day();
  return { total: `bloom:spend:${d}`, key: `bloom:spend:${d}:${identity}` };
};

// Micro-dollars as integers, so INCRBY stays exact.
const memory = new Map<string, number>();
const toMicro = (usd: number) => Math.round(usd * 1_000_000);

async function read(identity: string): Promise<{ total: number; key: number }> {
  const k = keys(identity);
  const cfg = kvConfig();
  if (cfg) {
    try {
      const [t, s] = (await kv(cfg, [["GET", k.total], ["GET", k.key]])) as (string | null)[];
      return { total: Number(t ?? 0) / 1_000_000, key: Number(s ?? 0) / 1_000_000 };
    } catch {
      // Fall through to this instance's own tally.
    }
  }
  return { total: (memory.get(k.total) ?? 0) / 1_000_000, key: (memory.get(k.key) ?? 0) / 1_000_000 };
}

export type SpendCheck = { ok: boolean; reason: "key_cap" | "daily_cap" | null; spentUsd: { total: number; key: number }; capsUsd: { total: number; key: number } };

/** Whether a live run for `identity` may start now. */
export async function checkSpend(identity: string): Promise<SpendCheck> {
  const spent = await read(identity);
  const caps = { total: DAILY_CAP_USD(), key: KEY_DAILY_CAP_USD() };
  const reason = spent.total >= caps.total ? "daily_cap" : spent.key >= caps.key ? "key_cap" : null;
  return { ok: reason === null, reason, spentUsd: spent, capsUsd: caps };
}

async function record(identity: string, usd: number) {
  if (!(usd > 0)) return;
  const k = keys(identity);
  const micro = toMicro(usd);
  memory.set(k.total, (memory.get(k.total) ?? 0) + micro);
  memory.set(k.key, (memory.get(k.key) ?? 0) + micro);
  if (memory.size > 5_000) memory.clear();
  const cfg = kvConfig();
  if (!cfg) return;
  try {
    await kv(cfg, [["INCRBY", k.total, micro], ["EXPIRE", k.total, 172_800], ["INCRBY", k.key, micro], ["EXPIRE", k.key, 172_800]]);
  } catch {
    // KV hiccup: this instance's tally above still counts the spend.
  }
}

/** USD for a usage on a model id as the provider reports it (Bloom id or OpenRouter slug); unknown models price as the dearest. */
export function priceUsd(model: string, usage: { input: number; output: number }): number {
  const m = MODELS.find((x) => x.id === model || x.openrouter === model) ?? MODELS.reduce((a, b) => (b.price[1] > a.price[1] ? b : a));
  return (usage.input / 1_000_000) * m.price[0] + (usage.output / 1_000_000) * m.price[1];
}

/**
 * Wraps a run's emit so a live run on the server's key is metered when it ends. Call `flush()` before closing
 * the response so the spend is recorded before a serverless function can freeze.
 */
export function meterRun(identity: string, live: boolean, send: (e: RunEvent) => void) {
  let model = "";
  let pending: Promise<void> = Promise.resolve();
  const emit = (e: RunEvent) => {
    send(e);
    if (!live) return;
    if (e.type === "run.start") model = e.model;
    else if (e.type === "run.end") pending = record(identity, priceUsd(model, e.usage)).catch(() => undefined);
  };
  return { emit, flush: () => pending };
}
