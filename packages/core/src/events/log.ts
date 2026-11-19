import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exchangeKeys, randomHex, sha256Hex } from "../crypto.ts";
import type { BloomEvent, BloomEventDraft, ReadOptions, ReadResult } from "./types.ts";

/**
 * The cursor store. Appends number events (`seq`) within an epoch; reads resume from an opaque cursor.
 *
 *   MemoryEventLog  default: a bounded ring per process. A restart starts a new epoch, so old cursors read
 *                   back `reset: true` instead of silently skipping events.
 *   FileEventLog    durable local storage: one JSONL file plus the epoch, so cursors survive restarts.
 *
 * A log is per node process. Nodes that run several instances behind a load balancer need a shared log, which
 * is not built yet; each instance then keeps its own feed.
 */
export interface EventLog {
  readonly epoch: string;
  append(draft: BloomEventDraft): BloomEvent;
  read(opts?: ReadOptions): ReadResult;
}

const MAX_LIMIT = 200;

export function parseCursor(cursor: string | null | undefined): { epoch: string; seq: number } | null {
  const m = typeof cursor === "string" ? /^([0-9a-f]{8,32})\.(\d{1,15})$/.exec(cursor) : null;
  return m ? { epoch: m[1], seq: Number(m[2]) } : null;
}

export class MemoryEventLog implements EventLog {
  readonly epoch: string;
  protected events: BloomEvent[] = [];
  protected seq = 0;
  private readonly kid: string;

  constructor(
    private readonly capacity = 5_000,
    epoch = randomHex(8),
  ) {
    this.epoch = epoch;
    this.kid = exchangeKeys().jwk.kid;
  }

  protected number(draft: BloomEventDraft): BloomEvent {
    const seq = ++this.seq;
    // `bxe_` (Bloom eXchange event, beside `bxk-` key ids): `evt_` already names settlement-webhook deliveries.
    return { ...draft, id: `bxe_${sha256Hex(`${this.kid}|${this.epoch}|${seq}`).slice(0, 24)}`, seq, cursor: `${this.epoch}.${seq}`, node: this.kid } as BloomEvent;
  }

  protected retain(e: BloomEvent) {
    this.events.push(e);
    if (this.events.length > this.capacity) this.events.splice(0, this.events.length - this.capacity);
  }

  append(draft: BloomEventDraft): BloomEvent {
    const e = this.number(draft);
    this.retain(e);
    return e;
  }

  read(opts: ReadOptions = {}): ReadResult {
    const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? 50)), MAX_LIMIT);
    const oldest = this.events[0]?.seq ?? this.seq + 1;
    const given = opts.cursor ? parseCursor(opts.cursor) : null;
    // A cursor from another epoch, from the future, or older than the window cannot resume exactly: start over.
    const reset = Boolean(opts.cursor) && (!given || given.epoch !== this.epoch || given.seq > this.seq || given.seq < oldest - 1);
    const after = given && !reset ? given.seq : 0;
    const types = opts.types?.length ? new Set<string>(opts.types) : null;

    const events: BloomEvent[] = [];
    let scanned = after;
    let i = this.events.findIndex((e) => e.seq > after);
    if (i < 0) i = this.events.length;
    for (; i < this.events.length && events.length < limit; i++) {
      const e = this.events[i];
      scanned = e.seq;
      if ((types && !types.has(e.type)) || (opts.where && !opts.where(e))) continue;
      events.push(e);
    }
    if (reset && i >= this.events.length) scanned = this.seq;
    return { events, cursor: `${this.epoch}.${scanned}`, reset, hasMore: i < this.events.length };
  }
}

export class FileEventLog extends MemoryEventLog {
  private readonly file: string;

  constructor(dir: string, capacity = 5_000) {
    mkdirSync(dir, { recursive: true });
    const epochFile = join(dir, "epoch");
    const existing = existsSync(epochFile) ? readFileSync(epochFile, "utf8").trim() : "";
    const epoch = /^[0-9a-f]{8,32}$/.test(existing) ? existing : randomHex(8);
    if (epoch !== existing) writeFileSync(epochFile, `${epoch}\n`);
    super(capacity, epoch);
    this.file = join(dir, "events.jsonl");
    if (existsSync(this.file)) {
      const raw = readFileSync(this.file, "utf8");
      if (raw && !raw.endsWith("\n")) appendFileSync(this.file, "\n");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line) as BloomEvent;
          if (typeof e.seq === "number" && e.seq > this.seq && e.cursor === `${epoch}.${e.seq}`) {
            this.seq = e.seq;
            this.retain(e);
          }
        } catch {
          // A torn last line from a crash: skip it, the next append starts a clean line.
        }
      }
    }
  }

  override append(draft: BloomEventDraft): BloomEvent {
    const e = this.number(draft);
    appendFileSync(this.file, `${JSON.stringify(e)}\n`);
    this.retain(e);
    return e;
  }
}
