import { agentCard } from "../agent-card";
import {
  A2A_HEADERS,
  callerFor,
  cancelTask,
  ERR,
  getTask,
  IdParams,
  limitCaller,
  mayViewOperator,
  prepareSend,
  replay,
  RpcError,
  SendParams,
  sendMessage,
  sseResponse,
  streamSend,
  type Caller,
} from "../gateway";
import { loadTask } from "../store";


export const OPTIONS = () => new Response(null, { status: 204, headers: A2A_HEADERS });

type Id = string | number | null;
type Envelope = { jsonrpc: "2.0"; id: Id; method: string; params?: unknown };

/** A2A v1.0 method names, plus the v0.3 slash-style aliases so older clients work unchanged. */
const METHODS: Record<string, "send" | "stream" | "get" | "cancel" | "subscribe" | "card"> = {
  SendMessage: "send",
  "message/send": "send",
  SendStreamingMessage: "stream",
  "message/stream": "stream",
  GetTask: "get",
  "tasks/get": "get",
  CancelTask: "cancel",
  "tasks/cancel": "cancel",
  SubscribeToTask: "subscribe",
  "tasks/resubscribe": "subscribe",
  GetExtendedAgentCard: "card",
  "agent/getAuthenticatedExtendedCard": "card",
};

const reply = (id: Id, body: { result: unknown } | { error: { code: number; message: string; data?: unknown } }) => ({ jsonrpc: "2.0" as const, id, ...body });
const errorOf = (err: unknown) => (err instanceof RpcError ? { code: err.code, message: err.message, ...(err.data !== undefined && { data: err.data }) } : { code: -32603, message: "Internal error" });
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(body, { status, headers: { ...A2A_HEADERS, ...extra } });

function envelope(raw: unknown): Envelope | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const idOk = e.id === undefined || e.id === null || typeof e.id === "string" || typeof e.id === "number";
  if (e.jsonrpc !== "2.0" || typeof e.method !== "string" || !idOk) return null;
  return { jsonrpc: "2.0", id: (e.id as Id) ?? null, method: e.method, params: e.params };
}

function params<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, raw: unknown): T {
  const p = schema.safeParse(raw ?? {});
  if (!p.success) throw ERR.invalidParams("Invalid params.", p.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`));
  return p.data;
}

async function unary(caller: Caller, e: Envelope, idem: string | null): Promise<{ body: ReturnType<typeof reply>; replayed?: boolean }> {
  const kind = METHODS[e.method];
  try {
    if (!kind) throw new RpcError(-32601, `Method not found: ${e.method}`, 404);
    if (kind === "stream" || kind === "subscribe") throw ERR.unsupported(`${e.method} streams; send it on its own, not in a batch.`);
    if (kind === "send") {
      const r = await sendMessage(caller, params(SendParams, e.params), idem);
      return { body: reply(e.id, { result: r.task }), replayed: r.replayed };
    }
    if (kind === "card") return { body: reply(e.id, { result: agentCard(caller.origin) }) };
    const p = params(IdParams, e.params);
    const task = kind === "get" ? await getTask(caller, p.id, p.historyLength) : await cancelTask(caller, p.id);
    return { body: reply(e.id, { result: task }) };
  } catch (err) {
    return { body: reply(e.id, { error: errorOf(err) }) };
  }
}

/** JSON-RPC 2.0 clearing gateway. Streaming methods answer with server-sent events, one JSON-RPC response per event. */
export async function POST(req: Request) {
  const caller = await callerFor(req);
  const limit = await limitCaller(caller);
  if (!limit.ok) return json(reply(null, { error: { code: -32029, message: "Rate limit reached. Retry in a minute.", data: { limit: limit.limit } } }), 429);

  const text = await req.text();
  if (text.length > 65_536) return json(reply(null, { error: { code: -32600, message: "Request too large (64 KB max)." } }), 413);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json(reply(null, { error: { code: -32700, message: "Parse error." } }), 400);
  }
  const idem = req.headers.get("idempotency-key")?.trim().slice(0, 200) || null;

  if (Array.isArray(raw)) {
    if (raw.length === 0 || raw.length > 20) return json(reply(null, { error: { code: -32600, message: "Batch must hold 1 to 20 requests." } }), 400);
    const out = [];
    for (const item of raw) {
      const e = envelope(item);
      // A shared Idempotency-Key can't sensibly cover several sends, so batches rely on each message's messageId.
      out.push(e ? (await unary(caller, e, null)).body : reply(null, { error: { code: -32600, message: "Invalid request." } }));
    }
    return json(out);
  }

  const e = envelope(raw);
  if (!e) return json(reply(null, { error: { code: -32600, message: "Invalid request." } }), 400);
  const kind = METHODS[e.method];

  if (kind === "stream") {
    let prepared;
    try {
      prepared = await prepareSend(caller, params(SendParams, e.params), idem);
    } catch (err) {
      return json(reply(e.id, { error: errorOf(err) }));
    }
    return sseResponse(
      async (send) => {
        try {
          await streamSend(caller, prepared, (r) => send(reply(e.id, { result: r })));
        } catch (err) {
          send(reply(e.id, { error: errorOf(err) }));
        }
      },
      prepared.kind === "replay" ? { "Idempotency-Replayed": "true" } : {},
    );
  }
  if (kind === "subscribe") {
    let id: string;
    try {
      id = params(IdParams, e.params).id;
      const rec = await loadTask(id);
      if (!rec || (rec.environment !== "sandbox" && rec.owner !== caller.owner && !caller.operator)) throw ERR.notFound();
      const operator = caller.wantsOperatorView && mayViewOperator(caller, rec);
      return sseResponse(async (send) => {
        try {
          await replay(id, operator, (r) => send(reply(e.id, { result: r })), req.signal);
        } catch (err) {
          send(reply(e.id, { error: errorOf(err) }));
        }
      });
    } catch (err) {
      return json(reply(e.id, { error: errorOf(err) }));
    }
  }

  const r = await unary(caller, e, idem);
  return json(r.body, 200, r.replayed ? { "Idempotency-Replayed": "true" } : {});
}
