import { merkleRoot, type Intent, type Room, type RoomEvent } from "@bloom-exchange/sdk";
import type { AgentRow, IntentQuery, ReceiptRow, RoomWrite, Store } from "./types.ts";

/**
 * Zero-config store for tests and local development: everything in one process, lost on restart. A per-room
 * promise chain gives the same one-writer-per-room guarantee the Postgres store gets from row locks.
 */
export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private readonly agents = new Map<string, AgentRow>();
  private readonly intents = new Map<string, Intent>();
  private readonly rooms = new Map<string, { room: Room; events: RoomEvent[] }>();
  private readonly receipts: ReceiptRow[] = [];
  private readonly locks = new Map<string, Promise<unknown>>();
  private ledgerLock: Promise<unknown> = Promise.resolve();

  async upsertAgent(pubkey: string, profile: { displayName?: string; org?: string; domain?: string } | null, now: Date): Promise<AgentRow> {
    const prior = this.agents.get(pubkey);
    const row: AgentRow = {
      pubkey,
      displayName: profile?.displayName ?? prior?.displayName ?? null,
      org: profile?.org ?? prior?.org ?? null,
      domain: profile?.domain ?? prior?.domain ?? null,
      domainVerified: false,
      createdAt: prior?.createdAt ?? now.toISOString(),
      lastSeenAt: now.toISOString(),
    };
    this.agents.set(pubkey, row);
    return row;
  }

  async getAgent(pubkey: string) {
    return this.agents.get(pubkey) ?? null;
  }

  async createIntent(intent: Intent) {
    this.intents.set(intent.id, structuredClone(intent));
  }

  async getIntent(id: string) {
    const i = this.intents.get(id);
    return i ? structuredClone(i) : null;
  }

  async listIntents(q: IntentQuery) {
    const completed = (pk: string) => this.receipts.filter((r) => !r.revoked && (r.buyer === pk || r.seller === pk)).length;
    return [...this.intents.values()]
      .filter((i) => i.status === "OPEN" && Date.parse(i.expiresAt) > q.now.getTime())
      .filter((i) => (!q.vertical || i.vertical === q.vertical) && (!q.role || i.role === q.role) && (!q.tag || i.capabilityTags.includes(q.tag)))
      .filter((i) => !q.minCompletedDeals || completed(i.owner) >= q.minCompletedDeals)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, q.limit)
      .map((i) => structuredClone(i));
  }

  async createRoom(room: Room, first: RoomEvent) {
    this.rooms.set(room.id, { room: structuredClone(room), events: [structuredClone(first)] });
  }

  async getRoom(id: string) {
    const r = this.rooms.get(id);
    return r ? structuredClone(r) : null;
  }

  async withRoom<T>(id: string, fn: (room: Room, events: RoomEvent[]) => Promise<{ write: RoomWrite | null; result: T }>) {
    const prior = this.locks.get(id) ?? Promise.resolve();
    const run = prior.then(async () => {
      const current = this.rooms.get(id);
      if (!current) return { found: false as const };
      const { write, result } = await fn(structuredClone(current.room), structuredClone(current.events));
      if (!write) return { found: true as const, result };
      let receipt: ReceiptRow | undefined;
      if (write.receipt) {
        const pending = write.receipt;
        const ledger = this.ledgerLock.then(async () => {
          const hashes = [...this.receipts.map((r) => r.hash), pending.hash];
          const row: ReceiptRow = { ...structuredClone(pending), leafIndex: this.receipts.length, root: await merkleRoot(hashes), revoked: false };
          this.receipts.push(row);
          return row;
        });
        this.ledgerLock = ledger.catch(() => undefined);
        receipt = structuredClone(await ledger);
      }
      this.rooms.set(id, { room: structuredClone(write.room), events: [...current.events, ...structuredClone(write.events)] });
      return { found: true as const, result, receipt };
    });
    this.locks.set(id, run.catch(() => undefined));
    return run;
  }

  async getReceipt(hash: string) {
    const r = this.receipts.find((x) => x.hash === hash);
    return r ? structuredClone(r) : null;
  }

  async ledgerHashes() {
    return this.receipts.map((r) => r.hash);
  }

  async receiptsFor(pubkey: string, limit: number) {
    return this.receipts
      .filter((r) => r.buyer === pubkey || r.seller === pubkey)
      .slice(-limit)
      .reverse()
      .map((r) => structuredClone(r));
  }

  async agentStats(pubkey: string) {
    const mine = this.receipts.filter((r) => r.buyer === pubkey || r.seller === pubkey);
    return {
      completed: mine.filter((r) => !r.revoked).length,
      revoked: mine.filter((r) => r.revoked).length,
      latenciesMs: mine.map((r) => Date.parse(r.clearedAt) - Date.parse(r.openedAt)),
    };
  }

  async feed(limit: number, now: Date) {
    return {
      receipts: this.receipts.slice(-limit).reverse().map((r) => ({ hash: r.hash, vertical: r.vertical, clearedAt: r.clearedAt })),
      openIntents: [...this.intents.values()].filter((i) => i.status === "OPEN" && Date.parse(i.expiresAt) > now.getTime()).length,
      cleared: this.receipts.length,
      agents: this.agents.size,
    };
  }
}
