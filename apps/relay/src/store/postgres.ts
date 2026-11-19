import pg from "pg";
import { merkleRoot, type Intent, type Room, type RoomEvent, type RelayReceipt } from "@bloom-exchange/sdk";
import type { AgentRow, IntentQuery, ReceiptRow, RoomWrite, Store } from "./types.ts";

/**
 * Postgres (or Supabase) store for supabase/migrations/001_phase2_relay.sql. One writer per room via
 * SELECT ... FOR UPDATE, and one ledger appender at a time via a transaction-scoped advisory lock, so leaf indexes
 * are dense and roots are computed over exactly the receipts before them, across any number of relay instances.
 */
const LEDGER_LOCK = 0x626c6f6f6d; // "bloom"

type Db = pg.Pool | pg.PoolClient;

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

function agentRow(r: Record<string, unknown>): AgentRow {
  return { pubkey: r.pubkey as string, displayName: (r.display_name as string) ?? null, org: (r.org as string) ?? null, domain: (r.domain as string) ?? null, domainVerified: r.domain_verified === true, createdAt: iso(r.created_at), lastSeenAt: iso(r.last_seen_at) };
}
function intentRow(r: Record<string, unknown>): Intent {
  return { id: r.id as string, owner: r.owner_pubkey as string, vertical: r.vertical as string, role: r.role as Intent["role"], capabilityTags: r.capability_tags as string[], spec: r.spec as Record<string, unknown>, status: r.status as Intent["status"], createdAt: iso(r.created_at), expiresAt: iso(r.expires_at) };
}
function eventRow(r: Record<string, unknown>): RoomEvent {
  return { roomId: r.room_id as string, seq: r.seq as number, type: r.type as RoomEvent["type"], by: r.actor as string, body: r.body as Record<string, unknown>, at: r.at as string, prevHash: r.prev_hash as string, hash: r.hash as string, auth: (r.auth as RoomEvent["auth"]) ?? null };
}
function receiptRow(r: Record<string, unknown>): ReceiptRow {
  return {
    hash: r.hash as string,
    roomId: r.room_id as string,
    receipt: r.body as RelayReceipt,
    signatures: r.signatures as ReceiptRow["signatures"],
    buyer: r.buyer_pubkey as string,
    seller: r.seller_pubkey as string,
    vertical: r.vertical as string,
    openedAt: iso(r.opened_at),
    clearedAt: iso(r.cleared_at),
    leafIndex: Number(r.merkle_leaf_index),
    root: r.merkle_root as string,
    revoked: r.revoked === true,
  };
}

async function insertEvents(db: Db, events: RoomEvent[]) {
  for (const e of events) {
    await db.query("insert into room_events (room_id, seq, type, actor, body, raw, auth, at, prev_hash, hash) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [
      e.roomId,
      e.seq,
      e.type,
      e.by,
      JSON.stringify(e.body),
      e.auth?.raw ?? null,
      e.auth ? JSON.stringify(e.auth) : null,
      e.at,
      e.prevHash,
      e.hash,
    ]);
  }
}

const roomColumns = (room: Room) => [
  room.id,
  room.intentId,
  room.vertical,
  room.status,
  room.buyer.pubkey,
  room.seller.pubkey,
  room.buyer.mandateCommitment,
  room.seller.mandateCommitment,
  room.rounds,
  room.maxRounds,
  room.seq,
  room.transcriptHead,
  room.receiptHash,
  room.openedAt,
  room.expiresAt,
  JSON.stringify(room),
];

export class PostgresStore implements Store {
  readonly kind = "postgres" as const;
  private readonly pool: pg.Pool;

  constructor(connectionString: string, opts: { max?: number; ssl?: boolean } = {}) {
    this.pool = new pg.Pool({ connectionString, max: opts.max ?? 10, ssl: opts.ssl ? { rejectUnauthorized: true } : undefined });
  }

  close() {
    return this.pool.end();
  }

  async upsertAgent(pubkey: string, profile: { displayName?: string; org?: string; domain?: string } | null, now: Date) {
    const r = await this.pool.query(
      `insert into agents (pubkey, display_name, org, domain, created_at, last_seen_at) values ($1,$2,$3,$4,$5,$5)
       on conflict (pubkey) do update set
         display_name = coalesce(excluded.display_name, agents.display_name),
         org = coalesce(excluded.org, agents.org),
         domain = coalesce(excluded.domain, agents.domain),
         domain_verified = case when excluded.domain is not null and excluded.domain is distinct from agents.domain then false else agents.domain_verified end,
         last_seen_at = excluded.last_seen_at
       returning *`,
      [pubkey, profile?.displayName ?? null, profile?.org ?? null, profile?.domain ?? null, now],
    );
    return agentRow(r.rows[0]);
  }

  async getAgent(pubkey: string) {
    const r = await this.pool.query("select * from agents where pubkey = $1", [pubkey]);
    return r.rows[0] ? agentRow(r.rows[0]) : null;
  }

  async createIntent(i: Intent) {
    await this.pool.query("insert into intents (id, owner_pubkey, vertical, role, capability_tags, spec, status, created_at, expires_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [i.id, i.owner, i.vertical, i.role, i.capabilityTags, JSON.stringify(i.spec), i.status, i.createdAt, i.expiresAt]);
  }

  async getIntent(id: string) {
    const r = await this.pool.query("select * from intents where id = $1", [id]);
    return r.rows[0] ? intentRow(r.rows[0]) : null;
  }

  async listIntents(q: IntentQuery) {
    const r = await this.pool.query(
      `select i.* from intents i
       where i.status = 'OPEN' and i.expires_at > $1
         and ($2::text is null or i.vertical = $2)
         and ($3::text is null or i.role = $3)
         and ($4::text is null or i.capability_tags @> array[$4::text])
         and ($5::int is null or (select count(*) from receipts r where not r.revoked and (r.buyer_pubkey = i.owner_pubkey or r.seller_pubkey = i.owner_pubkey)) >= $5)
       order by i.created_at desc limit $6`,
      [q.now, q.vertical ?? null, q.role ?? null, q.tag ?? null, q.minCompletedDeals ?? null, q.limit],
    );
    return r.rows.map(intentRow);
  }

  async createRoom(room: Room, first: RoomEvent) {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      await c.query(
        `insert into rooms (id, intent_id, vertical, status, buyer_pubkey, seller_pubkey, buyer_commitment, seller_commitment, rounds, max_rounds, seq, transcript_head, receipt_hash, opened_at, expires_at, snapshot)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        roomColumns(room),
      );
      await insertEvents(c, [first]);
      await c.query("commit");
    } catch (err) {
      await c.query("rollback").catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }

  private async load(db: Db, id: string, lock: boolean) {
    const r = await db.query(`select snapshot from rooms where id = $1${lock ? " for update" : ""}`, [id]);
    if (!r.rows[0]) return null;
    const ev = await db.query("select * from room_events where room_id = $1 order by seq", [id]);
    return { room: r.rows[0].snapshot as Room, events: ev.rows.map(eventRow) };
  }

  getRoom(id: string) {
    return this.load(this.pool, id, false);
  }

  async listRoomsFor(pubkey: string, q: { statuses?: Room["status"][]; limit: number }) {
    const r = await this.pool.query(
      `select snapshot from rooms where (buyer_pubkey = $1 or seller_pubkey = $1) and ($2::text[] is null or status = any($2::text[]))
       order by updated_at desc limit $3`,
      [pubkey, q.statuses?.length ? q.statuses : null, q.limit],
    );
    return r.rows.map((x) => x.snapshot as Room);
  }

  async withRoom<T>(id: string, fn: (room: Room, events: RoomEvent[]) => Promise<{ write: RoomWrite | null; result: T }>) {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      const current = await this.load(c, id, true);
      if (!current) {
        await c.query("rollback");
        return { found: false as const };
      }
      const { write, result } = await fn(current.room, current.events);
      let receipt: ReceiptRow | undefined;
      if (write) {
        const w = write.room;
        await c.query(
          `update rooms set status = $2, buyer_commitment = $3, seller_commitment = $4, rounds = $5, seq = $6, transcript_head = $7, receipt_hash = $8, snapshot = $9, updated_at = now()
           where id = $1`,
          [w.id, w.status, w.buyer.mandateCommitment, w.seller.mandateCommitment, w.rounds, w.seq, w.transcriptHead, w.receiptHash, JSON.stringify(w)],
        );
        await insertEvents(c, write.events);
        if (write.receipt) {
          await c.query("select pg_advisory_xact_lock($1)", [LEDGER_LOCK]);
          const prior = await c.query("select hash from receipts order by merkle_leaf_index");
          const hashes = [...prior.rows.map((x) => x.hash as string), write.receipt.hash];
          const rcpt = write.receipt;
          const ins = await c.query(
            `insert into receipts (hash, room_id, body, signatures, buyer_pubkey, seller_pubkey, vertical, opened_at, cleared_at, merkle_leaf_index, merkle_root)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
            [rcpt.hash, rcpt.roomId, JSON.stringify(rcpt.receipt), JSON.stringify(rcpt.signatures), rcpt.buyer, rcpt.seller, rcpt.vertical, rcpt.openedAt, rcpt.clearedAt, prior.rows.length, await merkleRoot(hashes)],
          );
          receipt = receiptRow(ins.rows[0]);
        }
      }
      await c.query("commit");
      return { found: true as const, result, receipt };
    } catch (err) {
      await c.query("rollback").catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }

  async getReceipt(hash: string) {
    const r = await this.pool.query("select * from receipts where hash = $1", [hash]);
    return r.rows[0] ? receiptRow(r.rows[0]) : null;
  }

  async ledgerHashes() {
    const r = await this.pool.query("select hash from receipts order by merkle_leaf_index");
    return r.rows.map((x) => x.hash as string);
  }

  async receiptsFor(pubkey: string, limit: number) {
    const r = await this.pool.query("select * from receipts where buyer_pubkey = $1 or seller_pubkey = $1 order by merkle_leaf_index desc limit $2", [pubkey, limit]);
    return r.rows.map(receiptRow);
  }

  async agentStats(pubkey: string) {
    const r = await this.pool.query(
      `select count(*) filter (where not revoked)::int as completed, count(*) filter (where revoked)::int as revoked,
              coalesce(array_agg((extract(epoch from (cleared_at - opened_at)) * 1000)::bigint) filter (where true), '{}') as latencies
       from receipts where buyer_pubkey = $1 or seller_pubkey = $1`,
      [pubkey],
    );
    const row = r.rows[0];
    return { completed: row.completed as number, revoked: row.revoked as number, latenciesMs: (row.latencies as (string | number)[]).map(Number) };
  }

  async feed(limit: number, now: Date) {
    const [recent, counts] = await Promise.all([
      this.pool.query("select hash, vertical, cleared_at from receipts order by merkle_leaf_index desc limit $1", [limit]),
      this.pool.query(
        `select (select count(*) from intents where status = 'OPEN' and expires_at > $1)::int as open_intents,
                (select count(*) from receipts)::int as cleared, (select count(*) from agents)::int as agents`,
        [now],
      ),
    ]);
    return {
      receipts: recent.rows.map((x) => ({ hash: x.hash as string, vertical: x.vertical as string, clearedAt: iso(x.cleared_at) })),
      openIntents: counts.rows[0].open_intents as number,
      cleared: counts.rows[0].cleared as number,
      agents: counts.rows[0].agents as number,
    };
  }
}
