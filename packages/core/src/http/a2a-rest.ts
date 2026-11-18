import {
  A2A_HEADERS,
  callerFor,
  cancelTask,
  ERR,
  getTask,
  limitCaller,
  mayViewOperator,
  prepareSend,
  replay,
  RpcError,
  SendParams,
  sendMessage,
  sseResponse,
  streamSend,
} from "../gateway";
import { loadTask } from "../store";


export const OPTIONS = () => new Response(null, { status: 204, headers: A2A_HEADERS });

/**
 * The A2A HTTP+JSON binding of the same gateway:
 *   POST /v1/message:send · POST /v1/message:stream · GET /v1/tasks/{id} · POST /v1/tasks/{id}:cancel · GET /v1/tasks/{id}:subscribe
 */
type Ctx = { params: Promise<{ path: string[] }> };

const fail = (err: unknown) => {
  const e = err instanceof RpcError ? err : new RpcError(-32603, "Internal error", 500);
  return Response.json({ error: { code: e.code, message: e.message, ...(e.data !== undefined && { details: e.data }) } }, { status: e.http, headers: A2A_HEADERS });
};

async function body(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > 65_536) throw new RpcError(-32600, "Request too large (64 KB max).", 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new RpcError(-32700, "Body must be valid JSON.", 400);
  }
}

function sendParams(raw: unknown) {
  const p = SendParams.safeParse(raw);
  if (!p.success) throw ERR.invalidParams("Invalid SendMessageRequest.", p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  return p.data;
}

export async function POST(req: Request, { params }: Ctx) {
  const path = (await params).path.join("/");
  try {
    const caller = await callerFor(req);
    const limit = await limitCaller(caller);
    if (!limit.ok) throw new RpcError(-32029, "Rate limit reached. Retry in a minute.", 429);
    const idem = req.headers.get("idempotency-key")?.trim().slice(0, 200) || null;

    if (path === "message:send") {
      const r = await sendMessage(caller, sendParams(await body(req)), idem);
      return Response.json({ task: r.task }, { headers: { ...A2A_HEADERS, ...(r.replayed && { "Idempotency-Replayed": "true" }) } });
    }
    if (path === "message:stream") {
      const prepared = await prepareSend(caller, sendParams(await body(req)), idem);
      return sseResponse((send) => streamSend(caller, prepared, send), prepared.kind === "replay" ? { "Idempotency-Replayed": "true" } : {});
    }
    const cancel = path.match(/^tasks\/([\w-]+):cancel$/);
    if (cancel) return Response.json(await cancelTask(caller, cancel[1]), { headers: A2A_HEADERS });
    throw new RpcError(-32601, `No route for POST ${path}`, 404);
  } catch (err) {
    return fail(err);
  }
}

export async function GET(req: Request, { params }: Ctx) {
  const path = (await params).path.join("/");
  try {
    const caller = await callerFor(req);
    const limit = await limitCaller(caller);
    if (!limit.ok) throw new RpcError(-32029, "Rate limit reached. Retry in a minute.", 429);

    const sub = path.match(/^tasks\/([\w-]+):subscribe$/);
    if (sub) {
      const rec = await loadTask(sub[1]);
      if (!rec || (rec.environment !== "sandbox" && rec.owner !== caller.owner && !caller.operator)) throw ERR.notFound();
      const operator = caller.wantsOperatorView && mayViewOperator(caller, rec);
      return sseResponse((send) => replay(rec.id, operator, send, req.signal));
    }
    const get = path.match(/^tasks\/([\w-]+)$/);
    if (get) {
      const h = Number(new URL(req.url).searchParams.get("historyLength"));
      return Response.json(await getTask(caller, get[1], Number.isInteger(h) && h >= 0 && new URL(req.url).searchParams.has("historyLength") ? h : undefined), { headers: A2A_HEADERS });
    }
    throw new RpcError(-32601, `No route for GET ${path}`, 404);
  } catch (err) {
    return fail(err);
  }
}
