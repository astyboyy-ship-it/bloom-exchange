import type { BloomEvent, DeliveryResult, EventAdapter } from "./types.ts";

/**
 * The hook registry: fans each event out to the adapters that want it, with bounded retries, idempotency and a
 * dead-letter list. Delivery never blocks or fails a negotiation; it runs after the event is logged.
 *
 * Idempotency: an (adapter, event id) pair is delivered at most once per process, even when the same event is
 * dispatched twice or concurrently. Each delivery also carries the event id as its idempotency key, so a receiver
 * can deduplicate across node restarts too.
 */
export type RegistryOptions = {
  /** Attempts per delivery, including the first. Default 3. */
  maxAttempts?: number;
  /** First retry delay; doubles each attempt. Default 250 ms. */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export type DeliveryOutcome = { adapter: string; eventId: string; status: "delivered" | "duplicate" | "failed"; attempts: number; reason?: string };
export type DeadLetter = { adapter: string; eventId: string; type: BloomEvent["type"]; attempts: number; reason: string; at: string };

const REMEMBER = 10_000;
const DEAD_LETTERS = 200;

export class AdapterRegistry {
  private readonly adapters = new Map<string, EventAdapter>();
  private readonly done = new Set<string>();
  private readonly inFlight = new Map<string, Promise<DeliveryOutcome>>();
  private readonly dead: DeadLetter[] = [];
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: RegistryOptions = {}) {
    this.maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
    this.backoffMs = Math.max(0, opts.backoffMs ?? 250);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  register(adapter: EventAdapter): this {
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(adapter.id)) throw new Error(`Invalid adapter id: ${adapter.id}`);
    if (this.adapters.has(adapter.id)) throw new Error(`An adapter with id ${adapter.id} is already registered.`);
    this.adapters.set(adapter.id, adapter);
    return this;
  }

  unregister(id: string): boolean {
    return this.adapters.delete(id);
  }

  list(): { id: string; name: string; events: EventAdapter["events"] }[] {
    return [...this.adapters.values()].map((a) => ({ id: a.id, name: a.name, events: a.events }));
  }

  deadLetters(): readonly DeadLetter[] {
    return this.dead;
  }

  async dispatch(event: BloomEvent): Promise<DeliveryOutcome[]> {
    const targets = [...this.adapters.values()].filter((a) => a.events === "*" || a.events.includes(event.type));
    return Promise.all(targets.map((a) => this.deliverOnce(a, event)));
  }

  private deliverOnce(adapter: EventAdapter, event: BloomEvent): Promise<DeliveryOutcome> {
    const key = `${adapter.id}|${event.id}`;
    if (this.done.has(key)) return Promise.resolve({ adapter: adapter.id, eventId: event.id, status: "duplicate", attempts: 0 });
    const running = this.inFlight.get(key);
    if (running) return running.then((o) => ({ ...o, status: o.status === "delivered" ? "duplicate" : o.status }));
    const p = this.attempt(adapter, event).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, p);
    return p;
  }

  private async attempt(adapter: EventAdapter, event: BloomEvent): Promise<DeliveryOutcome> {
    let last: DeliveryResult = { ok: false, retryable: false, reason: "not attempted" };
    let attempts = 0;
    for (let n = 1; n <= this.maxAttempts; n++) {
      attempts = n;
      try {
        last = await adapter.deliver(event, { attempt: n, idempotencyKey: event.id });
      } catch (err) {
        last = { ok: false, retryable: true, reason: `adapter error: ${String(err instanceof Error ? err.message : err).slice(0, 200)}` };
      }
      if (last.ok || !last.retryable) break;
      if (n < this.maxAttempts) await this.sleep(this.backoffMs * 2 ** (n - 1));
    }
    if (last.ok) {
      this.remember(`${adapter.id}|${event.id}`);
      return { adapter: adapter.id, eventId: event.id, status: "delivered", attempts };
    }
    this.dead.push({ adapter: adapter.id, eventId: event.id, type: event.type, attempts, reason: last.reason, at: new Date().toISOString() });
    if (this.dead.length > DEAD_LETTERS) this.dead.splice(0, this.dead.length - DEAD_LETTERS);
    return { adapter: adapter.id, eventId: event.id, status: "failed", attempts, reason: last.reason };
  }

  private remember(key: string) {
    this.done.add(key);
    if (this.done.size > REMEMBER) this.done.delete(this.done.values().next().value as string);
  }
}
