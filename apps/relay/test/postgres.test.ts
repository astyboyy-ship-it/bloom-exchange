import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import pg from "pg";
import { AgentKey, commitMandate, RelayTransport, signReceipt } from "@bloom-exchange/sdk";
import { withPrice, type ComputeGpuTerms } from "@bloom-exchange/schemas";
import { bootRelay } from "../../../tests/relay-harness.ts";
import { PostgresStore } from "../src/store/postgres.ts";

/**
 * The migration and the Postgres store against real PostgreSQL (PGlite: Postgres compiled to WebAssembly, served
 * over the wire protocol so the production `pg` driver connects to it). One connection, because PGlite runs a
 * single session: concurrent transactions would interleave on it and prove nothing.
 */
let db: PGlite;
let server: PGLiteSocketServer;
let url: string;
let store: PostgresStore;
let relay: Awaited<ReturnType<typeof bootRelay>>;

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });

const spec: ComputeGpuTerms = { vertical: "compute.gpu", accelerator: "H100-SXM-80GB", acceleratorCount: 4, vramGb: 80, durationSeconds: 3_600, containerDigest: `sha256:${"9e".repeat(32)}`, totalPriceAtomic: "120000", currency: "USD" };

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync(new URL("../../../supabase/migrations/001_phase2_relay.sql", import.meta.url), "utf8"));
  const port = await freePort();
  // Two connections: the store's pool (max 1) and the constraint test's own client, which run one at a time.
  server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 2 });
  await server.start();
  url = `postgres://postgres@127.0.0.1:${port}/postgres`;
  store = new PostgresStore(url, { max: 1 });
  relay = await bootRelay({ store });
}, 60_000);

afterAll(async () => {
  await relay?.close();
  await store?.close();
  await server?.stop();
  await db?.close();
});

describe("Postgres store and migration (real PostgreSQL via PGlite)", () => {
  it("clears a deal end to end: intents, rooms, transcript, ledger, reputation, discovery", async () => {
    const seller = new RelayTransport({ baseUrl: relay.url, key: await AgentKey.generate() });
    const buyer = new RelayTransport({ baseUrl: relay.url, key: await AgentKey.generate() });
    await seller.registerAgent({ displayName: "PG Seller", org: "Postgres Compute", domain: "pg.example" });
    const intent = await seller.publishIntent({ vertical: "compute.gpu", role: "seller", capabilityTags: ["h100", "pg"], spec, ttlSeconds: 3_600 });
    expect((await buyer.discoverIntents({ tag: "pg" })).map((i) => i.id)).toEqual([intent.id]); // GIN tag filter
    expect(await buyer.discoverIntents({ tag: "pg", minCompletedDeals: 1 })).toEqual([]);

    const bm = await commitMandate({ vertical: "compute.gpu", role: "buyer", currency: "USD", limitAtomic: "115000" });
    const sm = await commitMandate({ vertical: "compute.gpu", role: "seller", currency: "USD", limitAtomic: "90000" });
    const { room } = await buyer.openRoom({ intentId: intent.id, terms: withPrice(spec, "95000"), mandateCommitment: bm.commitment, maxRounds: 3 });
    await seller.sendEvent(room.id, { type: "COUNTER", terms: withPrice(spec, "110000"), mandateCommitment: sm.commitment });
    await buyer.sendEvent(room.id, { type: "ACCEPT" });
    const { receipt, hash } = await buyer.prepareReceipt(room.id);
    const signatures = { buyer: await signReceipt(buyer.key, hash), seller: await signReceipt(seller.key, hash) };
    const cleared = await seller.sendEvent(room.id, { type: "CLEAR", receipt: receipt as unknown as Record<string, unknown>, signatures });
    expect(cleared.room.status).toBe("CLEARED");

    const v = await buyer.verifyReceipt(hash, [bm.opening, sm.opening]);
    expect(v).toMatchObject({ valid: true, checks: { ledgerInclusion: "pass", mandateBounds: "pass" } });
    expect(v.payload.ledger).toMatchObject({ leafIndex: 0, treeSize: 1 });
    const rep = await buyer.getReputation(seller.key.publicKey);
    expect(rep).toMatchObject({ completedDeals: 1, disputeRate: 0, org: "Postgres Compute", domain: "pg.example", domainVerified: false });
    expect(rep.medianLatencyMs).toBeGreaterThanOrEqual(0);
    expect((await buyer.discoverIntents({ tag: "pg", minCompletedDeals: 1 })).map((i) => i.id)).toEqual([intent.id]);
    // The transcript round-trips byte-exactly through Postgres (hashes and signatures still verify).
    const { events } = await buyer.getRoom(room.id);
    expect(events.map((e) => e.type)).toEqual(["PROPOSE", "COUNTER", "ACCEPT", "CLEAR"]);
    const { verifyTranscript } = await import("@bloom-exchange/sdk");
    expect(await verifyTranscript(events)).toBeNull();
  });

  it("assigns dense leaf indexes and a fresh root per receipt", async () => {
    const seller = new RelayTransport({ baseUrl: relay.url, key: await AgentKey.generate() });
    const buyer = new RelayTransport({ baseUrl: relay.url, key: await AgentKey.generate() });
    const intent = await seller.publishIntent({ vertical: "compute.gpu", role: "seller", capabilityTags: [], spec, ttlSeconds: 3_600 });
    const bm = await commitMandate({ vertical: "compute.gpu", role: "buyer", currency: "USD", limitAtomic: "200000" });
    const sm = await commitMandate({ vertical: "compute.gpu", role: "seller", currency: "USD", limitAtomic: "1000" });
    const { room } = await buyer.openRoom({ intentId: intent.id, terms: spec, mandateCommitment: bm.commitment });
    await seller.sendEvent(room.id, { type: "ACCEPT", mandateCommitment: sm.commitment });
    const { receipt, hash } = await seller.prepareReceipt(room.id);
    await buyer.sendEvent(room.id, { type: "CLEAR", receipt: receipt as unknown as Record<string, unknown>, signatures: { buyer: await signReceipt(buyer.key, hash), seller: await signReceipt(seller.key, hash) } });
    const p = await buyer.getReceipt(hash);
    expect(p.ledger).toMatchObject({ leafIndex: 1, treeSize: 2 });
    expect((await buyer.verifyReceipt(p)).checks.ledgerInclusion).toBe("pass");
  });

  it("enforces append-only receipts and transcripts, and its constraints, in the database itself", async () => {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    try {
      const { rows } = await c.query("select hash from receipts order by merkle_leaf_index limit 1");
      const hash = rows[0].hash as string;
      await expect(c.query("update receipts set body = '{}'::jsonb where hash = $1", [hash])).rejects.toThrow(/append-only/);
      await expect(c.query("delete from receipts where hash = $1", [hash])).rejects.toThrow(/append-only/);
      await c.query("update receipts set revoked = true where hash = $1", [hash]); // the one allowed change
      await expect(c.query("update receipts set revoked = false where hash = $1", [hash])).rejects.toThrow(/append-only/);
      await expect(c.query("update room_events set body = '{}'::jsonb")).rejects.toThrow(/append-only/);
      await expect(c.query("delete from room_events")).rejects.toThrow(/append-only/);
      await expect(c.query("insert into agents (pubkey) values ('not-a-key')")).rejects.toThrow(/check constraint/);
      await expect(c.query("insert into intents (id, owner_pubkey, vertical, role, spec, created_at, expires_at) select 'in_' || repeat('a', 24), pubkey, 'compute.gpu', 'seller', '{\"vertical\":\"api.inference\"}', now(), now() + interval '1 hour' from agents limit 1")).rejects.toThrow(/check constraint/);
      const idx = await c.query("select indexname, indexdef from pg_indexes where tablename = 'intents'");
      const defs = idx.rows.map((r) => r.indexdef as string).join("\n");
      expect(defs).toMatch(/USING gin \(capability_tags\)/);
      expect(defs).toMatch(/WHERE \(status = 'OPEN'::text\)/);
      // The receipt just revoked counts as a dispute in its seller's reputation.
      const seller = (await c.query("select seller_pubkey from receipts where hash = $1", [hash])).rows[0].seller_pubkey as string;
      const rep = await new RelayTransport({ baseUrl: relay.url, key: await AgentKey.generate() }).getReputation(seller);
      expect(rep).toMatchObject({ completedDeals: 0, disputeRate: 1 });
      expect((await new RelayTransport({ baseUrl: relay.url, key: await AgentKey.generate() }).getReceipt(hash)).revoked).toBe(true);
    } finally {
      await c.end();
    }
  });
});
