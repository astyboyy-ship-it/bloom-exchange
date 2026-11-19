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

/**
 * Who is reading. A non-operator presents the task ids it holds (the capability GetTask accepts) and, when it
 * uses an access key, its owner hash. An anonymous caller's owner is derived from its client IP, which is not
 * stable enough to grant anything on its own (one host can reach a node as 127.0.0.1, ::1 or ::ffff:127.0.0.1).
 */
export type Reader = { operator: true } | { operator: false; owner: string; licensed: boolean; taskIds: ReadonlySet<string> };

const OWNERS = 20_000;

export class EventHub {
  private readonly listeners = new Set<{ fn: Listener; types: Set<string> | null }>();
  private readonly pending = new Set<Promise<DeliveryOutcome[]>>();
  /** taskId → owner hash. In memory only: after a restart, non-operators see only tasks created since. */
  private readonly owners = new Map<string, string>();

  constructor(
    readonly log: EventLog,
    readonly registry: AdapterRegistry = new AdapterRegistry(),
    private readonly defer: (task: () => unknown) => void = after,
    /** Adapters configured but refused at startup (for example a webhook with no allowlist), with the reason. */
    readonly disabled: { id: string; reason: string }[] = [],
  ) {}

  publish(draft: BloomEventDraft, owner?: string): BloomEvent {
    if (owner && !this.owners.has(draft.taskId)) {
      this.owners.set(draft.taskId, owner);
      if (this.owners.size > OWNERS) this.owners.delete(this.owners.keys().next().value as string);
    }
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

  /**
   * The visibility rule for every read path (JSON, SSE, MCP), mirroring GetTask and `mayViewOperator`:
   *   operator                   every event
   *   access-key holder          events of its own tasks (owner from the key, which is stable)
   *   anyone, given a task id    that task's events if it is a sandbox task, or if the caller owns it
   *   operator-audience events   (clamps, exception kinds) only in the sandbox: next to the offer prices they
   *                              would place the provider's floor, so a production counterparty never gets them
   * A caller never learns a task id it did not already hold: the feed enumerates ids, and a sandbox id unlocks
   * GetTask, resume and the sandbox operator stream.
   */
  visibleTo(reader: Reader): ((e: BloomEvent) => boolean) | undefined {
    if (reader.operator) return undefined;
    return (e) => {
      if (e.audience === "operator" && e.environment !== "sandbox") return false;
      const owned = this.owners.get(e.taskId) === reader.owner;
      if (reader.licensed && owned) return true;
      return reader.taskIds.has(e.taskId) && (e.environment === "sandbox" || owned);
    };
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

type Shared = { hub: EventHub | null; resolved: boolean };
// On globalThis: Next bundles each route separately, and they must share one hub (as store.ts does).
const shared = globalThis as typeof globalThis & { __bloomEventHub?: Shared };
shared.__bloomEventHub ??= { hub: null, resolved: false };
const state = shared.__bloomEventHub;

export type EnableOptions = { log?: EventLog; adapters?: EventAdapter[]; registry?: RegistryOptions; defer?: (task: () => unknown) => void };

export function enableEvents(opts: EnableOptions = {}): EventHub {
  const registry = new AdapterRegistry(opts.registry);
  for (const a of opts.adapters ?? []) registry.register(a);
  state.hub = new EventHub(opts.log ?? new MemoryEventLog(), registry, opts.defer);
  state.resolved = true;
  return state.hub;
}

export function disableEvents(): void {
  state.hub = null;
  state.resolved = true;
}

const on = (v: string | undefined) => /^(1|true|on|yes)$/i.test(v?.trim() ?? "");

/**
 * Builds the hub from the environment:
 *   BLOOM_EVENTS=1                     turn the feed on (memory log)
 *   BLOOM_EVENTS_DIR=./data/events     durable local log, so cursors survive restarts (one process per directory)
 *   BLOOM_EVENTS_JSONL=./data/audit.jsonl                         append every event to a local audit file
 *   BLOOM_EVENTS_WEBHOOK_URL + BLOOM_EVENTS_WEBHOOK_ALLOW (+ _SECRET)  signed POST of every event
 * A misconfigured adapter is refused, listed in `hub.disabled` and reported on stderr; it never fails the node.
 */
export function hubFromEnv(env: NodeJS.ProcessEnv = process.env): EventHub | null {
  if (!on(env.BLOOM_EVENTS)) return null;
  const registry = new AdapterRegistry();
  const disabled: { id: string; reason: string }[] = [];
  const add = (id: string, make: () => EventAdapter) => {
    try {
      registry.register(make());
    } catch (err) {
      disabled.push({ id, reason: err instanceof Error ? err.message : String(err) });
    }
  };
  const jsonl = env.BLOOM_EVENTS_JSONL?.trim();
  if (jsonl) add("jsonl", () => new JsonlSinkAdapter({ path: jsonl }));
  const hook = env.BLOOM_EVENTS_WEBHOOK_URL?.trim();
  const allow = (env.BLOOM_EVENTS_WEBHOOK_ALLOW ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (hook) add("webhook", () => new WebhookAdapter({ url: hook, allow, secret: env.BLOOM_EVENTS_WEBHOOK_SECRET?.trim() || undefined }));
  for (const d of disabled) console.warn(`[bloom-events] adapter "${d.id}" disabled: ${d.reason}`);
  const dir = env.BLOOM_EVENTS_DIR?.trim();
  return new EventHub(dir ? new FileEventLog(dir) : new MemoryEventLog(), registry, after, disabled);
}

/** The node's hub, or null when events are off (or could not start: the reason goes to stderr once). */
export function eventHub(): EventHub | null {
  if (!state.resolved) {
    state.resolved = true;
    try {
      state.hub = hubFromEnv();
    } catch (err) {
      state.hub = null;
      console.warn(`[bloom-events] feed not started: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return state.hub;
}

/** Called by the enclave for every internal event. Never throws; a no-op when events are off. */
export function observeEnclaveEvent(rec: EnclaveRecord, e: ExchangeEvent): void {
  try {
    const hub = eventHub();
    if (!hub) return;
    for (const draft of toBloomDrafts(rec, e)) hub.publish(draft, rec.owner);
  } catch {
    // The feed is best-effort; a negotiation never fails because of it.
  }
}
