import { after } from "../platform/after.ts";
import type { EnclaveRecord } from "../enclave.ts";
import type { ExchangeEvent } from "../types.ts";
import { FileEventLog, MemoryEventLog, type EventLog } from "./log.ts";
import { toBloomDrafts } from "./project.ts";
import { AdapterRegistry, type DeliveryOutcome, type RegistryOptions } from "./registry.ts";
import { JsonlSinkAdapter } from "./adapters/jsonl.ts";
import { WebhookAdapter } from "./adapters/webhook.ts";
import type { BloomEvent, BloomEventDraft, BloomEventType, EventAdapter, ReadOptions, ReadResult } from "./types.ts";

/**
 * The event hub: log (cursor store) + live subscribers (push) + adapter registry (post-event hooks).
 *
 * Opt-in. With events off (the default) the enclave's observer is a no-op and nothing is logged or delivered.
 * Turn them on with `enableEvents()` in code, or with BLOOM_EVENTS=1 on a node.
 */
export type Listener = (e: BloomEvent) => void;

export class EventHub {
  private readonly listeners = new Set<{ fn: Listener; types: Set<string> | null }>();
  private readonly pending = new Set<Promise<DeliveryOutcome[]>>();

  constructor(
    readonly log: EventLog,
    readonly registry: AdapterRegistry = new AdapterRegistry(),
    private readonly defer: (task: () => unknown) => void = after,
    /** Adapters configured but refused at startup (for example a webhook with no allowlist), with the reason. */
    readonly disabled: { id: string; reason: string }[] = [],
  ) {}

  publish(draft: BloomEventDraft): BloomEvent {
    const e = this.log.append(draft);
    for (const l of this.listeners) {
      if (l.types && !l.types.has(e.type)) continue;
      try {
        l.fn(e);
      } catch {
        // A subscriber can never affect the negotiation that produced the event.
      }
    }
    this.defer(() => {
      const p = this.registry.dispatch(e).catch(() => [] as DeliveryOutcome[]);
      this.pending.add(p);
      return p.finally(() => this.pending.delete(p));
    });
    return e;
  }

  subscribe(fn: Listener, types?: readonly BloomEventType[]): () => void {
    const entry = { fn, types: types?.length ? new Set<string>(types) : null };
    this.listeners.add(entry);
    return () => this.listeners.delete(entry);
  }

  read(opts?: ReadOptions): ReadResult {
    return this.log.read(opts);
  }

  /** Resolves once every delivery started so far has finished (tests, graceful shutdown). */
  async idle(): Promise<void> {
    await new Promise((r) => setTimeout(r, 0));
    while (this.pending.size) await Promise.all([...this.pending]);
  }
}

type Shared = { hub: EventHub | null; fromEnv: boolean };
// On globalThis: Next bundles each route separately, and they must share one hub (as store.ts does).
const shared = globalThis as typeof globalThis & { __bloomEventHub?: Shared };
shared.__bloomEventHub ??= { hub: null, fromEnv: false };
const state = shared.__bloomEventHub;

export type EnableOptions = { log?: EventLog; adapters?: EventAdapter[]; registry?: RegistryOptions; defer?: (task: () => unknown) => void };

export function enableEvents(opts: EnableOptions = {}): EventHub {
  const registry = new AdapterRegistry(opts.registry);
  for (const a of opts.adapters ?? []) registry.register(a);
  state.hub = new EventHub(opts.log ?? new MemoryEventLog(), registry, opts.defer);
  state.fromEnv = true;
  return state.hub;
}

export function disableEvents(): void {
  state.hub = null;
  state.fromEnv = true;
}

const on = (v: string | undefined) => /^(1|true|on|yes)$/i.test(v?.trim() ?? "");

/**
 * Builds the hub from the environment, once:
 *   BLOOM_EVENTS=1                     turn the feed on (memory log)
 *   BLOOM_EVENTS_DIR=./data/events     durable local log, so cursors survive restarts
 *   BLOOM_EVENTS_JSONL=./data/audit.jsonl                         append every event to a local audit file
 *   BLOOM_EVENTS_WEBHOOK_URL + BLOOM_EVENTS_WEBHOOK_ALLOW (+ _SECRET)  signed POST of every event
 */
export function hubFromEnv(env: NodeJS.ProcessEnv = process.env): EventHub | null {
  if (!on(env.BLOOM_EVENTS)) return null;
  const registry = new AdapterRegistry();
  const disabled: { id: string; reason: string }[] = [];
  const jsonl = env.BLOOM_EVENTS_JSONL?.trim();
  if (jsonl) registry.register(new JsonlSinkAdapter({ path: jsonl }));
  const hook = env.BLOOM_EVENTS_WEBHOOK_URL?.trim();
  if (hook) {
    const allow = (env.BLOOM_EVENTS_WEBHOOK_ALLOW ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    try {
      registry.register(new WebhookAdapter({ url: hook, allow, secret: env.BLOOM_EVENTS_WEBHOOK_SECRET?.trim() || undefined }));
    } catch (err) {
      disabled.push({ id: "webhook", reason: err instanceof Error ? err.message : String(err) });
    }
  }
  const dir = env.BLOOM_EVENTS_DIR?.trim();
  return new EventHub(dir ? new FileEventLog(dir) : new MemoryEventLog(), registry, after, disabled);
}

/** The node's hub, or null when events are off. */
export function eventHub(): EventHub | null {
  if (!state.fromEnv) {
    state.fromEnv = true;
    state.hub = hubFromEnv();
  }
  return state.hub;
}

/** Called by the enclave for every internal event. Never throws; a no-op when events are off. */
export function observeEnclaveEvent(rec: EnclaveRecord, e: ExchangeEvent): void {
  try {
    const hub = eventHub();
    if (!hub) return;
    for (const draft of toBloomDrafts(rec, e)) hub.publish(draft);
  } catch {
    // The feed is best-effort; a negotiation never fails because of it.
  }
}
