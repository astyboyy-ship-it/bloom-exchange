
/**
 * Minimal Vercel KV / Upstash Redis client over the REST pipeline endpoint (no dependency). Configured by
 * KV_REST_API_URL + KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN. Callers fall back
 * to per-instance memory when it is not configured.
 */
export type KvConfig = { url: string; token: string };

export function kvConfig(): KvConfig | null {
  const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)?.replace(/\/+$/, "");
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

/** Runs Redis commands in one round trip. Throws on transport or command errors. */
export async function kv(cfg: KvConfig, commands: (string | number)[][]): Promise<unknown[]> {
  const res = await fetch(`${cfg.url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
    cache: "no-store",
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`KV ${res.status}`);
  const out = (await res.json()) as { result?: unknown; error?: string }[];
  const failed = out.find((x) => x.error);
  if (failed) throw new Error(`KV ${failed.error}`);
  return out.map((x) => x.result);
}
