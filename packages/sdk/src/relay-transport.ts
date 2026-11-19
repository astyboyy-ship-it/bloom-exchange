import type { AgentKey } from "./agent-key.ts";
import { authHeaders, signRequest, signedSocketUrl } from "./relay-auth.ts";
import { canonicalize } from "./canonical.ts";
import { receiptDraft, receiptFromTranscript, receiptHash, verifyRelayReceipt, type ReceiptPayload, type ReceiptVerification, type RelayReceipt, type Room, type RoomEvent } from "./relay-protocol.ts";
import type { MandateOpening } from "./mandate.ts";
import { sseJson } from "./sse.ts";

/**
 * The edge's connection to a Bloom clearing relay. Every mutating request (and every read of a private room) is
 * signed with the agent's Ed25519 key; the relay verifies and never signs for anyone.
 *
 *   const relay = new RelayTransport({ baseUrl: "https://bloom-exchange-relay.vercel.app", key: await AgentKey.generate() });
 *   const intent = await relay.publishIntent({ vertical: "compute.gpu", role: "seller", capabilityTags: ["h100"], spec, ttlSeconds: 3600 });
 */
export const DEFAULT_RELAY_URL = "https://bloom-exchange-relay.vercel.app";

export type RelayTransportOptions = {
  baseUrl?: string;
  key: AgentKey;
  fetch?: typeof fetch;
  /** WebSocket constructor; defaults to the global one (Node 22+, browsers). Without one, subscriptions use SSE. */
  WebSocket?: typeof WebSocket | null;
};

export class RelayError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "RelayError";
    this.status = status;
    this.code = code;
  }
}

export type Intent = {
  id: string;
  owner: string;
  vertical: string;
  role: "buyer" | "seller";
  capabilityTags: string[];
  spec: Record<string, unknown>;
  status: "OPEN" | "CLOSED";
  createdAt: string;
  expiresAt: string;
};
export type IntentFilter = { vertical?: string; role?: "buyer" | "seller"; tag?: string; minCompletedDeals?: number; limit?: number };
export type Reputation = {
  pubkey: string;
  completedDeals: number;
  disputeRate: number;
  medianLatencyMs: number | null;
  domain: string | null;
  org: string | null;
  domainVerified: boolean;
  recentReceipts: { hash: string; vertical: string; clearedAt: string }[];
};

export type RoomEventInput =
  | { type: "COUNTER"; terms: Record<string, unknown>; mandateCommitment?: string }
  | { type: "ACCEPT"; mandateCommitment?: string }
  | { type: "REJECT" }
  | { type: "SIGN"; signature: string }
  | { type: "CLEAR"; receipt: Record<string, unknown>; signatures: { buyer: string; seller: string } };

export type SubscribeMode = "auto" | "ws" | "sse" | "poll";
export type Subscription = { close(): void; readonly mode: Exclude<SubscribeMode, "auto"> };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class RelayTransport {
  readonly baseUrl: string;
  readonly key: AgentKey;
  private readonly f: typeof fetch;
  private readonly WS: typeof WebSocket | null;

  constructor(opts: RelayTransportOptions) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_RELAY_URL).replace(/\/+$/, "");
    this.key = opts.key;
    this.f = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.WS = opts.WebSocket === undefined ? (typeof globalThis.WebSocket === "function" ? globalThis.WebSocket : null) : opts.WebSocket;
  }

  /** One request. `signed` requests carry the four X-Bloom-* headers over the exact body sent. */
  private async call<T>(method: "GET" | "POST", target: string, opts: { body?: unknown; signed?: boolean; signal?: AbortSignal } = {}): Promise<T> {
    const raw = opts.body === undefined ? "" : JSON.stringify(opts.body);
    const headers: Record<string, string> = { Accept: "application/json", ...(raw && { "Content-Type": "application/json" }) };
    if (opts.signed) Object.assign(headers, authHeaders(await signRequest(this.key, method, target, raw)));
    const res = await this.f(`${this.baseUrl}${target}`, { method, headers, body: raw || undefined, signal: opts.signal });
    const j = (await res.json().catch(() => null)) as (T & { error?: { code?: string; message?: string } }) | null;
    if (!res.ok || !j) throw new RelayError(res.status, j?.error?.code ?? "http_error", j?.error?.message ?? `relay answered ${res.status}`);
    return j;
  }

  registerAgent(profile: { displayName?: string; org?: string; domain?: string } = {}) {
    return this.call<{ agent: { pubkey: string; displayName: string | null; org: string | null; domain: string | null; domainVerified: boolean } }>("POST", "/v1/agents", { body: profile, signed: true });
  }

  publishIntent(intent: { vertical: string; role: "buyer" | "seller"; capabilityTags: string[]; spec: Record<string, unknown>; ttlSeconds: number }) {
    return this.call<{ intent: Intent }>("POST", "/v1/intents", { body: intent, signed: true }).then((r) => r.intent);
  }

  /** Public discovery: open, unexpired intents. Unsigned. */
  discoverIntents(filter: IntentFilter = {}) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filter)) if (v !== undefined && v !== "") q.set(k, String(v));
    const s = q.toString();
    return this.call<{ intents: Intent[] }>("GET", `/v1/intents${s ? `?${s}` : ""}`).then((r) => r.intents);
  }

  /** Opens a room on an intent with a first offer (PROPOSE) and this side's sealed mandate commitment. */
  openRoom(input: { intentId: string; terms: Record<string, unknown>; mandateCommitment: string; maxRounds?: number; ttlSeconds?: number }) {
    return this.call<{ room: Room; event: RoomEvent }>("POST", "/v1/rooms", { body: input, signed: true });
  }

  /** Rooms this agent is a party to, most recently active first (how an intent's owner finds new rooms). */
  listRooms(filter: { status?: Room["status"][]; limit?: number } = {}) {
    const q = new URLSearchParams();
    if (filter.status?.length) q.set("status", filter.status.join(","));
    if (filter.limit) q.set("limit", String(filter.limit));
    const s = q.toString();
    return this.call<{ rooms: Room[] }>("GET", `/v1/rooms${s ? `?${s}` : ""}`, { signed: true }).then((r) => r.rooms);
  }

  getRoom(roomId: string) {
    return this.call<{ room: Room; events: RoomEvent[] }>("GET", `/v1/rooms/${encodeURIComponent(roomId)}`, { signed: true });
  }

  sendEvent(roomId: string, event: RoomEventInput) {
    return this.call<{ room: Room; event: RoomEvent }>("POST", `/v1/rooms/${encodeURIComponent(roomId)}/events`, { body: event, signed: true });
  }

  listEvents(roomId: string, after = 0) {
    return this.call<{ events: RoomEvent[]; room: Room }>("GET", `/v1/rooms/${encodeURIComponent(roomId)}/events?after=${after}`, { signed: true });
  }

  /**
   * The receipt to sign for an ACCEPTED room, derived independently from the signed transcript and checked
   * against the relay's draft. Throws (and so gets no signature) if they differ in any byte.
   */
  async prepareReceipt(roomId: string): Promise<{ receipt: RelayReceipt; hash: string; room: Room }> {
    const { room, events } = await this.getRoom(roomId);
    if (room.status !== "ACCEPTED") throw new RelayError(409, "not_accepted", `room is ${room.status}`);
    const mine = await receiptFromTranscript(room, events);
    if (canonicalize(mine) !== canonicalize(receiptDraft(room))) throw new RelayError(409, "draft_mismatch", "the relay's receipt draft differs from the signed transcript");
    return { receipt: mine, hash: await receiptHash(mine), room };
  }

  getReceipt(hash: string) {
    return this.call<ReceiptPayload>("GET", `/v1/receipts/${encodeURIComponent(hash)}`);
  }

  getReputation(pubkey: string) {
    return this.call<{ reputation: Reputation }>("GET", `/v1/agents/${encodeURIComponent(pubkey)}/reputation`).then((r) => r.reputation);
  }

  /**
   * Fetches a cleared receipt (or takes one already in hand) and verifies it locally: canonical hash, both
   * signatures, the ledger inclusion proof, and any mandate openings given. The relay's answer is never trusted.
   */
  async verifyReceipt(hashOrPayload: string | ReceiptPayload, openings: MandateOpening[] = []): Promise<ReceiptVerification & { payload: ReceiptPayload }> {
    const payload = typeof hashOrPayload === "string" ? await this.getReceipt(hashOrPayload) : hashOrPayload;
    return { ...(await verifyRelayReceipt(payload, openings)), payload };
  }

  /**
   * Streams a room's events, in order, each exactly once, resuming after `after`. Tries a WebSocket first,
   * reconnecting with backoff; after repeated failures (or with no WebSocket available) falls back to SSE, then to
   * polling.
   */
  subscribeRoom(roomId: string, onEvent: (e: RoomEvent) => void, opts: { after?: number; mode?: SubscribeMode; pollMs?: number; onError?: (err: unknown) => void } = {}): Subscription {
    let last = opts.after ?? 0;
    let closed = false;
    let socket: WebSocket | null = null;
    const abort = new AbortController();
    const deliver = (e: RoomEvent) => {
      if (closed || e.roomId !== roomId || e.seq <= last) return;
      last = e.seq;
      onEvent(e);
    };
    let mode: Exclude<SubscribeMode, "auto"> = opts.mode && opts.mode !== "auto" ? opts.mode : this.WS ? "ws" : "sse";
    const sub: Subscription = {
      close: () => {
        closed = true;
        abort.abort();
        socket?.close();
      },
      get mode() {
        return mode;
      },
    };
    const path = `/v1/rooms/${encodeURIComponent(roomId)}`;

    const poll = async () => {
      mode = "poll";
      while (!closed) {
        try {
          const { events } = await this.call<{ events: RoomEvent[] }>("GET", `${path}/events?after=${last}`, { signed: true, signal: abort.signal });
          events.forEach(deliver);
        } catch (err) {
          if (!closed) opts.onError?.(err);
        }
        await sleep(opts.pollMs ?? 1000);
      }
    };

    const sse = async () => {
      mode = "sse";
      let failures = 0;
      while (!closed && failures < 3) {
        try {
          const target = `${path}/events?after=${last}`;
          const res = await this.f(`${this.baseUrl}${target}`, { headers: { Accept: "text/event-stream", ...authHeaders(await signRequest(this.key, "GET", target)) }, signal: abort.signal });
          if (!res.ok || !res.body) throw new RelayError(res.status, "sse_unavailable", `SSE answered ${res.status}`);
          failures = 0;
          for await (const frame of sseJson(res.body)) deliver(frame as RoomEvent);
        } catch (err) {
          if (closed) return;
          failures++;
          opts.onError?.(err);
          await sleep(250 * 2 ** failures);
        }
      }
      if (!closed && opts.mode !== "sse") await poll();
    };

    const ws = async () => {
      const WS = this.WS;
      if (!WS) return sse();
      mode = "ws";
      // Two upgrades that never open (a relay on serverless has no WebSocket) and the stream falls back to SSE;
      // a socket that opened and later dropped just reconnects.
      let failures = 0;
      while (!closed && failures < 2) {
        const opened = await new Promise<boolean>((resolve) => {
          void (async () => {
            const url = new URL(`${this.baseUrl.replace(/^http/, "ws")}${path}/stream`);
            url.searchParams.set("after", String(last));
            const s = new WS((await signedSocketUrl(this.key, url)).toString());
            socket = s;
            let wasOpen = false;
            s.onopen = () => {
              wasOpen = true;
              failures = 0;
            };
            s.onmessage = (m) => {
              try {
                const msg = JSON.parse(String(m.data)) as { kind?: string; event?: RoomEvent };
                if (msg.kind === "event" && msg.event) deliver(msg.event);
              } catch {
                // ignore a malformed frame
              }
            };
            s.onerror = (err) => {
              if (!closed) opts.onError?.(err);
            };
            s.onclose = () => resolve(wasOpen);
          })().catch((err) => {
            opts.onError?.(err);
            resolve(false);
          });
        });
        if (closed) return;
        if (!opened) failures++;
        await sleep(Math.min(5000, 250 * 2 ** failures));
      }
      if (!closed && opts.mode !== "ws") await sse();
    };

    void (mode === "ws" ? ws() : mode === "sse" ? sse() : poll());
    return sub;
  }
}
