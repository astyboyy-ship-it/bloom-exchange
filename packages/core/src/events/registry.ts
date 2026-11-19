import type { BloomEvent, DeliveryResult, EventAdapter } from "./types.ts";

/**
 * The hook registry: fans each event out to the adapters that want it, with bounded retries, idempotency and a
 * dead-letter list. Delivery never blocks or fails a negotiation; it runs after the event is logged.
 *
 * Ordering and back-pressure: each adapter has its own serial queue, so it receives events in log order and a
 * slow or dead receiver holds at most one delivery (with its retries) at a time. A queue that grows past
 * `maxQueue` dead-letters new events instead of buffering without bound. One slow adapter never delays another.
 *
 * Idempotency: an (adapter, event id) pair is dispatched once per process; re-dispatching it is a no-op. A single
 * dispatch can still reach a receiver more than once (a timeout after the receiver processed the request, then a
 * retry), so every delivery carries the event id as its idempotency key and receivers should deduplicate on it.
 */
export type RegistryOptions = {
  /** Attempts per delivery, including the first. Default 3. */
  maxAttempts?: number;
  /** First retry delay; doubles each attempt. Default 250 ms. */
  backoffMs?: number;
  /** Events waiting per adapter before new ones are dead-lettered. Default 1000. */
  maxQueue?: number;
  sleep?: (ms: number) => Promise<void>;
};

export type DeliveryOutcome = { adapter: string; eventId: string; status: "delivered" | "duplicate" | "failed"; attempts: number; reason?: string };
export type DeadLetter = { adapter: string; eventId: string; type: BloomEvent["type"]; attempts: number; reason: string; at: string };

const REMEMBER = 10_000;
const DEAD_LETTERS = 200;

export class AdapterRegistry {
  private readonly adapters = new Map<string, EventAdapter>();
  private readonly queues = new Map<string, { tail: Promise<unknown>; size: number }>();
  private readonly done = new Set<string>();
  private readonly dead: DeadLetter[] = [];
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly maxQueue: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: RegistryOptions = {}) {
    this.maxAttempts = Math.min(Math.max(1, opts.maxAttempts ?? 3), 10);
    this.backoffMs = Math.min(Math.max(0, opts.backoffMs ?? 250), 30_000);
    this.maxQueue = Math.max(1, opts.maxQueue ?? 1_000);
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

  dispatch(event: BloomEvent): Promise<DeliveryOutcome[]> {
    const targets = [...this.adapters.values()].filter((a) => a.events === "*" || a.events.includes(event.type));
    return Promise.all(targets.map((a) => this.enqueue(a, event)));
  }

  private enqueue(adapter: EventAdapter, event: BloomEvent): Promise<DeliveryOutcome> {
    const q = this.queues.get(adapter.id) ?? { tail: Promise.resolve(), size: 0 };
    this.queues.set(adapter.id, q);
    if (q.size >= this.maxQueue) return Promise.resolve(this.fail(adapter, event, 0, `queue full (${this.maxQueue} waiting)`));
    q.size++;
    const run = q.tail.then(() => this.deliverOnce(adapter, event)).finally(() => q.size--);
    q.tail = run.catch(() => undefined);
    return run;
  }

  private async deliverOnce(adapter: EventAdapter, event: BloomEvent): Promise<DeliveryOutcome> {
    const key = `${adapter.id}|${event.id}`;
    if (this.done.has(key)) return { adapter: adapter.id, eventId: event.id, status: "duplicate", attempts: 0 };
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
    if (!last.ok) return this.fail(adapter, event, attempts, last.reason);
    this.done.add(key);
    if (this.done.size > REMEMBER) this.done.delete(this.done.values().next().value as string);
    return { adapter: adapter.id, eventId: event.id, status: "delivered", attempts };
  }

  private fail(adapter: EventAdapter, event: BloomEvent, attempts: number, reason: string): DeliveryOutcome {
    this.dead.push({ adapter: adapter.id, eventId: event.id, type: event.type, attempts, reason, at: new Date().toISOString() });
    if (this.dead.length > DEAD_LETTERS) this.dead.splice(0, this.dead.length - DEAD_LETTERS);
    return { adapter: adapter.id, eventId: event.id, status: "failed", attempts, reason };
  }
}
