import type { Intent, Room, RoomEvent, RelayReceipt } from "@bloom-exchange/sdk";

/** What the relay persists. Two implementations: Postgres (production) and memory (tests, local dev). */
export type AgentRow = { pubkey: string; displayName: string | null; org: string | null; domain: string | null; domainVerified: boolean; createdAt: string; lastSeenAt: string };
export type ReceiptRow = {
  hash: string;
  roomId: string;
  receipt: RelayReceipt;
  signatures: { buyer: string; seller: string };
  buyer: string;
  seller: string;
  vertical: string;
  openedAt: string;
  clearedAt: string;
  leafIndex: number;
  /** Ledger root right after this receipt was appended. */
  root: string;
  revoked: boolean;
};
export type IntentQuery = { vertical?: string; role?: "buyer" | "seller"; tag?: string; minCompletedDeals?: number; limit: number; now: Date };

/** A room transaction's outcome: the new state, events to append, and (on CLEAR) the receipt to ledger. */
export type RoomWrite = { room: Room; events: RoomEvent[]; receipt?: Omit<ReceiptRow, "leafIndex" | "root" | "revoked"> };

export interface Store {
  readonly kind: "memory" | "postgres";
  upsertAgent(pubkey: string, profile: { displayName?: string; org?: string; domain?: string } | null, now: Date): Promise<AgentRow>;
  getAgent(pubkey: string): Promise<AgentRow | null>;
  createIntent(intent: Intent): Promise<void>;
  getIntent(id: string): Promise<Intent | null>;
  listIntents(q: IntentQuery): Promise<Intent[]>;
  createRoom(room: Room, first: RoomEvent): Promise<void>;
  getRoom(id: string): Promise<{ room: Room; events: RoomEvent[] } | null>;
  /** Rooms this key is the buyer or seller in, most recently active first. */
  listRoomsFor(pubkey: string, q: { statuses?: Room["status"][]; limit: number }): Promise<Room[]>;
  /**
   * Runs `fn` with the room locked (one writer at a time per room, across instances for Postgres). `fn` returns
   * the write to apply, or null to change nothing. A receipt in the write is appended to the ledger in the same
   * transaction and gets the next leaf index.
   */
  withRoom<T>(id: string, fn: (room: Room, events: RoomEvent[]) => Promise<{ write: RoomWrite | null; result: T }>): Promise<{ found: false } | { found: true; result: T; receipt?: ReceiptRow }>;
  getReceipt(hash: string): Promise<ReceiptRow | null>;
  /** Every receipt hash in ledger order (leaf 0 first). */
  ledgerHashes(): Promise<string[]>;
  receiptsFor(pubkey: string, limit: number): Promise<ReceiptRow[]>;
  agentStats(pubkey: string): Promise<{ completed: number; revoked: number; latenciesMs: number[] }>;
  feed(limit: number, now: Date): Promise<{ receipts: { hash: string; vertical: string; clearedAt: string }[]; openIntents: number; cleared: number; agents: number }>;
}
