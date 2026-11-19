/**
 * Replay protection: each (pubkey, nonce) may be used once within NONCE_TTL_SECONDS.
 *   Upstash Redis (REST)  SET key 1 NX EX 60, shared by every relay instance
 *   memory                the same semantics in one process, for local development and tests
 * A Redis error rejects the request (fail closed): an unverifiable nonce is treated as a replay.
 */
export interface NonceStore {
  readonly kind: "redis" | "memory";
  /** True when the nonce was unused and is now claimed; false on a replay. */
  claim(key: string, ttlSeconds: number): Promise<boolean>;
}

export class MemoryNonceStore implements NonceStore {
  readonly kind = "memory" as const;
  private readonly seen = new Map<string, number>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    const t = this.now();
    if (this.seen.size > 10_000) for (const [k, exp] of this.seen) if (exp <= t) this.seen.delete(k);
    const exp = this.seen.get(key);
    if (exp !== undefined && exp > t) return false;
    this.seen.set(key, t + ttlSeconds * 1000);
    return true;
  }
}

export class UpstashNonceStore implements NonceStore {
  readonly kind = "redis" as const;
  private readonly url: string;
  private readonly token: string;
  private readonly f: typeof fetch;

  constructor(url: string, token: string, f: typeof fetch = fetch) {
    this.url = url.replace(/\/+$/, "");
    this.token = token;
    this.f = f;
  }

  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    const res = await this.f(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(["SET", key, "1", "NX", "EX", String(ttlSeconds)]),
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) throw new Error(`redis answered ${res.status}`);
    const j = (await res.json()) as { result?: unknown; error?: string };
    if (j.error) throw new Error("redis error");
    return j.result === "OK";
  }
}
