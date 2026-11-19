import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { WebSocketServer, type WebSocket } from "ws";
import { eventHash, GENESIS_HASH, inclusionProof, merkleRoot, PUBKEY, signableTarget, TERMINAL, type Intent, type ReceiptPayload, type Room, type RoomEvent } from "@bloom-exchange/sdk";
import { isVertical, validateIntent } from "@bloom-exchange/schemas";
import { authenticate, type Authenticated } from "./auth.ts";
import { applyMove, isExpired, MoveError, offer, parseMove, roleOf } from "./machine.ts";
import type { NonceStore } from "./nonce.ts";
import type { RoomWrite, Store } from "./store/types.ts";

/**
 * The Bloom clearing relay. Dumb by design: it authenticates callers, enforces the room state machine, keeps the
 * transcript and the receipt ledger, and fans events out. It never holds a private key, never sees a mandate (only
 * 64-hex commitments) and never signs anything: receipts carry the buyer's and the seller's own signatures.
 */
export type RelayOptions = {
  store: Store;
  nonces: NonceStore;
  /** The relay's public origin, written into every room and receipt. */
  publicUrl: string;
  /** Where receipts can be verified in a browser. */
  verifierUrl?: string;
  now?: () => Date;
  version?: string;
};

const MAX_BODY = 64 * 1024;
const ROOM_ID = /^rm_[0-9a-f]{24}$/;
const INTENT_ID = /^in_[0-9a-f]{24}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const TAG = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const DOMAIN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const TEXT = /^[^\p{Cc}\p{Cf}]+$/u;

type Err = { status: number; code: string; message: string };
const err = (status: number, code: string, message: string): Err => ({ status, code, message });

export function createRelay(opts: RelayOptions) {
  const { store, nonces } = opts;
  const now = opts.now ?? (() => new Date());
  const publicUrl = opts.publicUrl.replace(/\/+$/, "");
  const verifierUrl = (opts.verifierUrl ?? "https://verify.bloomexchange.ai").replace(/\/+$/, "");
  const bus = new EventEmitter();
  bus.setMaxListeners(0);
  const app = new Hono();

  const fail = (c: Context, e: Err) => c.json({ error: { code: e.code, message: e.message } }, e.status as 400);

  app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["Content-Type", "X-Bloom-Pubkey", "X-Bloom-Timestamp", "X-Bloom-Nonce", "X-Bloom-Signature"], maxAge: 600 }));
  app.use("*", bodyLimit({ maxSize: MAX_BODY, onError: (c) => fail(c, err(413, "body_too_large", "Request bodies are limited to 64 KiB.")) }));
  app.onError((e, c) => fail(c, e instanceof MoveError ? err(e.status, e.code, e.message) : err(500, "internal", "Internal error.")));
  app.notFound((c) => fail(c, err(404, "not_found", "No such endpoint.")));

  /** The exact request target the client signed: the raw one from the socket when served by Node. */
  const targetOf = (c: Context) => {
    const raw = (c.env as { incoming?: IncomingMessage } | undefined)?.incoming?.url;
    if (raw && raw.startsWith("/")) return raw;
    const u = new URL(c.req.url);
    return `${u.pathname}${u.search}`;
  };

  /** Authenticates a request and returns its caller and exact raw body. */
  async function signed(c: Context): Promise<{ auth: Authenticated; raw: string; target: string } | Response> {
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const target = targetOf(c);
    const a = await authenticate({ method: c.req.method, target, get: (n) => c.req.header(n), rawBody: bytes, nonces, now: now().getTime() });
    if (!a.ok) return fail(c, err(a.status, a.code, a.message));
    let raw: string;
    try {
      raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return fail(c, err(400, "bad_request", "The body must be UTF-8."));
    }
    return { auth: a, raw, target };
  }

  function json(raw: string): Record<string, unknown> | Err {
    try {
      const v = JSON.parse(raw);
      return v && typeof v === "object" && !Array.isArray(v) ? v : err(400, "bad_request", "The body must be a JSON object.");
    } catch {
      return err(400, "bad_request", "The body is not valid JSON.");
    }
  }
  const isErr = (v: unknown): v is Err => typeof v === "object" && v !== null && "status" in v && "code" in v;

  async function eventFor(room: Room, type: RoomEvent["type"], by: string, body: Record<string, unknown>, auth: RoomEvent["auth"], at: string): Promise<RoomEvent> {
    const draft = { roomId: room.id, seq: room.seq + 1, type, by, body, at, prevHash: room.transcriptHead };
    return { ...draft, hash: await eventHash(draft), auth };
  }

  /** Records expiry if the room's time is up (an EXPIRE event by the relay). Returns the current room. */
  async function settleExpiry(id: string): Promise<{ room: Room; events: RoomEvent[] } | null> {
    const t = now();
    let emitted: RoomEvent | null = null;
    const r = await store.withRoom(id, async (room, events) => {
      if (!isExpired(room, t)) return { write: null, result: { room, events } };
      const e = await eventFor(room, "EXPIRE", "relay", {}, null, t.toISOString());
      emitted = e;
      const next: Room = { ...room, status: "EXPIRED", seq: e.seq, transcriptHead: e.hash };
      return { write: { room: next, events: [e] }, result: { room: next, events: [...events, e] } };
    });
    if (!r.found) return null;
    if (emitted) bus.emit(id, emitted);
    return r.result;
  }

  // -------------------------------------------------------------------------------------------------------
  // Health, agents, discovery
  // -------------------------------------------------------------------------------------------------------

  app.get("/health", (c) => c.json({ ok: true, service: "bloom-relay", version: opts.version ?? "0.2.0", store: store.kind, nonces: nonces.kind, time: now().toISOString() }));

  app.post("/v1/agents", async (c) => {
    const s = await signed(c);
    if (s instanceof Response) return s;
    const b = s.raw ? json(s.raw) : {};
    if (isErr(b)) return fail(c, b);
    const extra = Object.keys(b).filter((k) => !["displayName", "org", "domain"].includes(k));
    if (extra.length) return fail(c, err(400, "unknown_field", "Allowed fields: displayName, org, domain."));
    const text = (v: unknown, max: number) => v === undefined || (typeof v === "string" && v.length >= 1 && v.length <= max && TEXT.test(v));
    if (!text(b.displayName, 80) || !text(b.org, 120)) return fail(c, err(400, "bad_profile", "displayName (up to 80) and org (up to 120) must be printable text."));
    if (b.domain !== undefined && (typeof b.domain !== "string" || !DOMAIN.test(b.domain))) return fail(c, err(400, "bad_domain", "domain must be a lowercase hostname, e.g. agents.example.com."));
    const agent = await store.upsertAgent(s.auth.pubkey, b as { displayName?: string; org?: string; domain?: string }, now());
    return c.json({ agent }, 201);
  });

  app.post("/v1/intents", async (c) => {
    const s = await signed(c);
    if (s instanceof Response) return s;
    const b = json(s.raw);
    if (isErr(b)) return fail(c, b);
    const v = validateIntent(b);
    if (!v.ok) return fail(c, err(422, "invalid_intent", v.errors.slice(0, 5).join("; ")));
    const t = now();
    await store.upsertAgent(s.auth.pubkey, null, t);
    const intent: Intent = {
      id: `in_${randomBytes(12).toString("hex")}`,
      owner: s.auth.pubkey,
      vertical: v.value.vertical,
      role: v.value.role,
      capabilityTags: v.value.capabilityTags,
      spec: v.value.spec as unknown as Record<string, unknown>,
      status: "OPEN",
      createdAt: t.toISOString(),
      expiresAt: new Date(t.getTime() + v.value.ttlSeconds * 1000).toISOString(),
    };
    await store.createIntent(intent);
    return c.json({ intent }, 201);
  });

  app.get("/v1/intents", async (c) => {
    const q = c.req.query();
    if (q.vertical && !isVertical(q.vertical)) return fail(c, err(400, "bad_filter", "Unknown vertical."));
    if (q.role && q.role !== "buyer" && q.role !== "seller") return fail(c, err(400, "bad_filter", "role is buyer or seller."));
    if (q.tag && !TAG.test(q.tag)) return fail(c, err(400, "bad_filter", "Malformed tag."));
    const min = q.minCompletedDeals === undefined ? undefined : Number(q.minCompletedDeals);
    if (min !== undefined && (!Number.isSafeInteger(min) || min < 0)) return fail(c, err(400, "bad_filter", "minCompletedDeals is a non-negative integer."));
    const limit = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 100);
    const intents = await store.listIntents({ vertical: q.vertical, role: q.role as "buyer" | "seller" | undefined, tag: q.tag, minCompletedDeals: min, limit, now: now() });
    return c.json({ intents });
  });

  // -------------------------------------------------------------------------------------------------------
  // Rooms
  // -------------------------------------------------------------------------------------------------------

  app.post("/v1/rooms", async (c) => {
    const s = await signed(c);
    if (s instanceof Response) return s;
    const b = json(s.raw);
    if (isErr(b)) return fail(c, b);
    const extra = Object.keys(b).filter((k) => !["intentId", "terms", "mandateCommitment", "maxRounds", "ttlSeconds"].includes(k));
    if (extra.length) return fail(c, err(400, "unknown_field", "Allowed fields: intentId, terms, mandateCommitment, maxRounds, ttlSeconds."));
    if (typeof b.intentId !== "string" || !INTENT_ID.test(b.intentId)) return fail(c, err(400, "bad_intent", "intentId is required."));
    if (typeof b.mandateCommitment !== "string" || !HEX64.test(b.mandateCommitment)) return fail(c, err(400, "bad_commitment", "mandateCommitment must be 64 lowercase hex (a salted SHA-256 commitment, never the mandate)."));
    const maxRounds = b.maxRounds === undefined ? 6 : b.maxRounds;
    const ttl = b.ttlSeconds === undefined ? 3600 : b.ttlSeconds;
    if (typeof maxRounds !== "number" || !Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 20) return fail(c, err(400, "bad_rounds", "maxRounds is an integer from 1 to 20."));
    if (typeof ttl !== "number" || !Number.isInteger(ttl) || ttl < 60 || ttl > 86_400) return fail(c, err(400, "bad_ttl", "ttlSeconds is an integer from 60 to 86400."));

    const t = now();
    const intent = await store.getIntent(b.intentId);
    if (!intent || intent.status !== "OPEN" || Date.parse(intent.expiresAt) <= t.getTime()) return fail(c, err(404, "intent_unavailable", "No open intent with that id."));
    if (intent.owner === s.auth.pubkey) return fail(c, err(409, "own_intent", "You cannot open a room on your own intent."));
    await store.upsertAgent(s.auth.pubkey, null, t);
    const opener = s.auth.pubkey;
    const buyer = intent.role === "seller" ? opener : intent.owner;
    const seller = intent.role === "seller" ? intent.owner : opener;
    const id = `rm_${randomBytes(12).toString("hex")}`;
    const base: Room = {
      id,
      relay: publicUrl,
      intentId: intent.id,
      vertical: intent.vertical,
      status: "PROPOSED",
      buyer: { pubkey: buyer, mandateCommitment: buyer === opener ? b.mandateCommitment : null },
      seller: { pubkey: seller, mandateCommitment: seller === opener ? b.mandateCommitment : null },
      lastOffer: null,
      rounds: 0,
      maxRounds,
      openedAt: t.toISOString(),
      expiresAt: new Date(t.getTime() + ttl * 1000).toISOString(),
      accepted: null,
      signatures: {},
      receiptHash: null,
      transcriptHead: GENESIS_HASH,
      seq: 0,
    };
    const o = offer(base, b.terms);
    if (o.currency !== intent.spec.currency) return fail(c, err(422, "currency_mismatch", "The offer must use the intent's currency."));
    const auth = { method: "POST", path: s.target, timestamp: s.auth.timestamp, nonce: s.auth.nonce, signature: s.auth.signature, raw: s.raw };
    const event = await eventFor(base, "PROPOSE", opener, b, auth, t.toISOString());
    const room: Room = { ...base, lastOffer: { ...o, by: opener, seq: 1 }, seq: 1, transcriptHead: event.hash };
    await store.createRoom(room, event);
    return c.json({ room, event }, 201);
  });

  /** Loads a room for an authenticated caller; 404 for anyone who is not its buyer or seller. */
  async function roomFor(c: Context, auth: Authenticated) {
    const id = c.req.param("id") ?? "";
    if (!ROOM_ID.test(id)) return null;
    const r = await settleExpiry(id);
    return r && roleOf(r.room, auth.pubkey) ? r : null;
  }

  /**
   * The caller's own rooms (signed): how an intent's owner learns a counterparty opened a room on it. Only rooms
   * the key is a party to; nothing about anyone else's.
   */
  app.get("/v1/rooms", async (c) => {
    const s = await signed(c);
    if (s instanceof Response) return s;
    const STATUSES = ["PROPOSED", "COUNTERED", "ACCEPTED", "REJECTED", "EXPIRED", "CLEARED"];
    const statuses = (c.req.query("status") ?? "").split(",").filter(Boolean);
    if (statuses.some((x) => !STATUSES.includes(x))) return fail(c, err(400, "bad_filter", "status is a comma-separated list of room states."));
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 20) || 20, 1), 50);
    const listed = await store.listRoomsFor(s.auth.pubkey, { statuses: statuses as Room["status"][], limit });
    // Record any expiry that is due, so a listing never shows a dead room as open.
    const rooms = await Promise.all(listed.map(async (r) => (isExpired(r, now()) ? ((await settleExpiry(r.id))?.room ?? r) : r)));
    return c.json({ rooms: statuses.length ? rooms.filter((r) => statuses.includes(r.status)) : rooms });
  });

  app.get("/v1/rooms/:id", async (c) => {
    const s = await signed(c);
    if (s instanceof Response) return s;
    const r = await roomFor(c, s.auth);
    return r ? c.json(r) : fail(c, err(404, "room_not_found", "No such room."));
  });

  app.post("/v1/rooms/:id/events", async (c) => {
    const s = await signed(c);
    if (s instanceof Response) return s;
    const b = json(s.raw);
    if (isErr(b)) return fail(c, b);
    const move = parseMove(b);
    const current = await roomFor(c, s.auth);
    if (!current) return fail(c, err(404, "room_not_found", "No such room."));
    if (TERMINAL.includes(current.room.status)) return fail(c, err(409, "room_closed", `The room is ${current.room.status}.`));
    const auth = { method: "POST", path: s.target, timestamp: s.auth.timestamp, nonce: s.auth.nonce, signature: s.auth.signature, raw: s.raw };
    const at = now().toISOString();
    const out = await store.withRoom(current.room.id, async (room) => {
      // Re-checked under the lock: the room may have expired since it was loaded (the next read records EXPIRE).
      if (isExpired(room, new Date(at))) throw new MoveError(409, "room_expired", "The room has expired.");
      const applied = await applyMove(room, move, s.auth.pubkey, at, room.seq + 1);
      const e = await eventFor(room, move.type, s.auth.pubkey, b, auth, at);
      const next: Room = { ...applied.room, seq: e.seq, transcriptHead: e.hash, ...(move.type === "ACCEPT" && applied.room.accepted && { accepted: { ...applied.room.accepted, eventHash: e.hash } }) };
      const write: RoomWrite = { room: next, events: [e] };
      if (applied.receipt) {
        write.receipt = { hash: applied.receipt.hash, roomId: room.id, receipt: applied.receipt.body, signatures: applied.receipt.signatures, buyer: room.buyer.pubkey, seller: room.seller.pubkey, vertical: room.vertical, openedAt: room.openedAt, clearedAt: at };
      }
      return { write, result: { room: next, event: e } };
    });
    if (!out.found) return fail(c, err(404, "room_not_found", "No such room."));
    bus.emit(current.room.id, out.result.event);
    return c.json({ ...out.result, ...(out.receipt && { receipt: { hash: out.receipt.hash, leafIndex: out.receipt.leafIndex, verifyUrl: `${verifierUrl}/r/${out.receipt.hash}` } }) }, 201);
  });

  /** The transcript after `after`: JSON for pollers, or SSE (replay, then live) with Accept: text/event-stream. */
  app.get("/v1/rooms/:id/events", async (c) => {
    const s = await signed(c);
    if (s instanceof Response) return s;
    const r = await roomFor(c, s.auth);
    if (!r) return fail(c, err(404, "room_not_found", "No such room."));
    const after = Math.max(0, Number(c.req.query("after") ?? 0) || 0);
    if (!(c.req.header("accept") ?? "").includes("text/event-stream")) return c.json({ room: r.room, events: r.events.filter((e) => e.seq > after) });
    return streamSSE(c, async (stream) => {
      let last = after;
      const queue: RoomEvent[] = [];
      const listener = (e: RoomEvent) => queue.push(e);
      bus.on(r.room.id, listener);
      try {
        const send = async (e: RoomEvent) => {
          if (e.seq <= last) return;
          last = e.seq;
          await stream.writeSSE({ id: String(e.seq), data: JSON.stringify(e) });
        };
        for (const e of r.events) await send(e);
        const until = Date.now() + 100_000;
        while (!stream.aborted && Date.now() < until) {
          while (queue.length) await send(queue.shift()!);
          await stream.sleep(250);
        }
      } finally {
        bus.off(r.room.id, listener);
      }
    });
  });

  // -------------------------------------------------------------------------------------------------------
  // Receipts, reputation, feed
  // -------------------------------------------------------------------------------------------------------

  app.get("/v1/receipts/:hash", async (c) => {
    const hash = c.req.param("hash");
    if (!HEX64.test(hash)) return fail(c, err(400, "bad_hash", "A receipt hash is 64 lowercase hex."));
    const row = await store.getReceipt(hash);
    if (!row) return fail(c, err(404, "receipt_not_found", "No cleared receipt with that hash."));
    const hashes = await store.ledgerHashes();
    const payload: ReceiptPayload & { verifyUrl: string; rootAtInsertion: string } = {
      hash: row.hash,
      receipt: row.receipt,
      signatures: row.signatures,
      clearedAt: row.clearedAt,
      revoked: row.revoked,
      ledger: { leafIndex: row.leafIndex, treeSize: hashes.length, root: await merkleRoot(hashes), proof: await inclusionProof(hashes, row.leafIndex) },
      rootAtInsertion: row.root,
      verifyUrl: `${verifierUrl}/r/${row.hash}`,
    };
    return c.json(payload);
  });

  app.get("/v1/agents/:pubkey/reputation", async (c) => {
    const pubkey = c.req.param("pubkey");
    if (!PUBKEY.test(pubkey)) return fail(c, err(400, "bad_pubkey", "A public key is 43 base64url characters."));
    const agent = await store.getAgent(pubkey);
    if (!agent) return fail(c, err(404, "agent_not_found", "No agent with that key."));
    const [stats, recent] = await Promise.all([store.agentStats(pubkey), store.receiptsFor(pubkey, 10)]);
    const total = stats.completed + stats.revoked;
    const sorted = [...stats.latenciesMs].sort((a, b) => a - b);
    const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)) : null;
    return c.json({
      reputation: {
        pubkey,
        completedDeals: stats.completed,
        disputeRate: total ? stats.revoked / total : 0,
        medianLatencyMs: median,
        domain: agent.domain,
        org: agent.org,
        domainVerified: agent.domainVerified,
        recentReceipts: recent.map((r) => ({ hash: r.hash, vertical: r.vertical, clearedAt: r.clearedAt })),
      },
    });
  });

  app.get("/v1/feed", async (c) => c.json(await store.feed(20, now())));

  // -------------------------------------------------------------------------------------------------------
  // WebSocket stream: authenticated and room-checked before the upgrade is accepted.
  // -------------------------------------------------------------------------------------------------------

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const STREAM = /^\/v1\/rooms\/(rm_[0-9a-f]{24})\/stream$/;

  function refuse(socket: Duplex, status: number, code: string, message: string) {
    const body = JSON.stringify({ error: { code, message } });
    socket.end(`HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : status === 404 ? "Not Found" : status === 503 ? "Service Unavailable" : "Bad Request"}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
  }

  async function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const url = new URL(req.url ?? "/", "http://relay.invalid");
    const m = STREAM.exec(url.pathname);
    if (!m) return refuse(socket, 404, "not_found", "No such endpoint.");
    const a = await authenticate({
      method: "GET",
      target: signableTarget(url),
      get: (n) => {
        const h = req.headers[n.toLowerCase()];
        return (Array.isArray(h) ? h[0] : h) ?? url.searchParams.get(n);
      },
      rawBody: new Uint8Array(0),
      nonces,
      now: now().getTime(),
    });
    if (!a.ok) return refuse(socket, a.status, a.code, a.message);
    const r = await settleExpiry(m[1]);
    if (!r || !roleOf(r.room, a.pubkey)) return refuse(socket, 404, "room_not_found", "No such room.");
    const after = Math.max(0, Number(url.searchParams.get("after") ?? 0) || 0);
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      let last = after;
      const send = (e: RoomEvent) => {
        if (e.seq <= last || ws.readyState !== ws.OPEN) return;
        last = e.seq;
        ws.send(JSON.stringify({ kind: "event", event: e }));
      };
      bus.on(r.room.id, send);
      r.events.forEach(send);
      ws.send(JSON.stringify({ kind: "ready", seq: last, status: r.room.status }));
      const ping = setInterval(() => ws.ping(), 25_000);
      ws.on("close", () => {
        clearInterval(ping);
        bus.off(r.room.id, send);
      });
      ws.on("message", () => undefined); // the stream is one-way; moves go through POST
    });
  }

  function attach(server: Server) {
    server.on("upgrade", (req, socket, head) => {
      upgrade(req, socket, head).catch(() => refuse(socket, 503, "internal", "Upgrade failed."));
    });
  }

  return { app, attach, bus, close: () => wss.close() };
}
