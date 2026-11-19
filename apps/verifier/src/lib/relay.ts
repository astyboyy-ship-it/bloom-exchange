import type { ReceiptPayload, Reputation } from "@bloom-exchange/sdk";

/** The relay this deployment reads from. Set NEXT_PUBLIC_BLOOM_RELAY_URL at build time. */
export const RELAY_URL = (process.env.NEXT_PUBLIC_BLOOM_RELAY_URL ?? "https://relay.bloomexchange.ai").replace(/\/+$/, "");

export const HEX64 = /^[0-9a-f]{64}$/;
export const PUBKEY = /^[A-Za-z0-9_-]{43}$/;

export class RelayFetchError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function get<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${RELAY_URL}${path}`, { headers: { Accept: "application/json" }, cache: "no-store" });
  } catch {
    throw new RelayFetchError(0, "The relay could not be reached.");
  }
  const j = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!res.ok || !j) throw new RelayFetchError(res.status, j?.error?.message ?? `The relay answered ${res.status}.`);
  return j;
}

export const fetchReceipt = (hash: string) => get<ReceiptPayload>(`/v1/receipts/${hash}`);
export const fetchReputation = (pubkey: string) => get<{ reputation: Reputation }>(`/v1/agents/${encodeURIComponent(pubkey)}/reputation`).then((r) => r.reputation);
export type Feed = { receipts: { hash: string; vertical: string; clearedAt: string }[]; openIntents: number; cleared: number; agents: number };
export const fetchFeed = () => get<Feed>("/v1/feed");

/** Formats an atomic amount for display: a known currency's decimals, else the raw atomic count. */
export function formatAtomic(atomic: string, currency: string): string {
  const decimals: Record<string, number> = { USD: 2, EUR: 2, GBP: 2, USDC: 6, USDT: 6 };
  const d = decimals[currency];
  if (d === undefined || !/^\d+$/.test(atomic)) return `${atomic} ${currency} (atomic)`;
  const s = atomic.padStart(d + 1, "0");
  const whole = s.slice(0, -d).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${whole}.${s.slice(-d)} ${currency}`;
}

export const short = (s: string, n = 10) => (s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-6)}` : s);

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
