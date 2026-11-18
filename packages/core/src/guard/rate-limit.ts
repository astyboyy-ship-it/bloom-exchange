import { kv, kvConfig } from "../platform/kv";

/**
 * Fixed-window rate limiter. With Vercel KV / Upstash configured the counter is shared by every serverless
 * instance (INCR + EXPIRE), so it can't be bypassed by landing on a fresh instance; without it, it falls back to
 * a per-instance in-memory window. If KV errors, the in-memory window still applies (fail closed-ish, never open).
 */

const memory = new Map<string, { count: number; resetAt: number }>();

function memoryHit(key: string, windowS: number): number {
  const now = Date.now();
  const cur = memory.get(key);
  if (!cur || cur.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowS * 1000 });
    if (memory.size > 10_000) memory.clear();
    return 1;
  }
  cur.count++;
  return cur.count;
}

export type LimitResult = { ok: boolean; count: number; limit: number; shared: boolean };

/** Counts one hit for `id` in `scope` and reports whether it is within `limit` per `windowS` seconds. */
export async function rateLimit(scope: string, id: string, limit: number, windowS = 60): Promise<LimitResult> {
  const bucket = Math.floor(Date.now() / (windowS * 1000));
  const key = `bloom:rl:${scope}:${id}:${bucket}`;
  const local = memoryHit(key, windowS);
  const cfg = kvConfig();
  if (cfg) {
    try {
      const [count] = (await kv(cfg, [["INCR", key], ["EXPIRE", key, windowS * 2]])) as [number, unknown];
      return { ok: Number(count) <= limit, count: Number(count), limit, shared: true };
    } catch {
      // KV unavailable: the per-instance window below still limits this request.
    }
  }
  return { ok: local <= limit, count: local, limit, shared: false };
}

/** The caller's IP as Vercel / proxies report it. */
export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
