import * as a2a from "./a2a.ts";
import * as a2aRest from "./a2a-rest.ts";
import * as agentCard from "./agent-card.ts";
import * as decision from "./decision.ts";
import * as ingest from "./ingest.ts";
import * as intents from "./intents.ts";
import * as ledger from "./ledger.ts";
import * as mandate from "./mandate.ts";
import * as node from "./node.ts";
import * as peers from "./peers.ts";
import * as pulse from "./pulse.ts";
import * as status from "./status.ts";
import * as stream from "./stream.ts";
import * as task from "./task.ts";

/**
 * Every Bloom Exchange endpoint as one `(Request) => Promise<Response>` function, for hosts without file-based
 * routing (Node's http, Bun.serve, Deno.serve, Workers) and for in-process clients and tests:
 *
 *   Bun.serve({ fetch: handle });
 *   new BloomExchangeClient({ baseUrl, fetch: (u, i) => handle(new Request(u, i)) });
 *
 * Paths match a Next.js node exactly, so SDKs and Agent Cards work against either.
 */
type Handler = (req: Request, ctx: { params: Promise<Record<string, string | string[]>> }) => Response | Promise<Response>;
type Route = { pattern: RegExp; methods: Partial<Record<string, Handler>>; params?: (m: RegExpMatchArray) => Record<string, string | string[]> };

const h = (fn: unknown) => fn as Handler;

const ROUTES: Route[] = [
  { pattern: /^\/\.well-known\/agent-card\.json$/, methods: { GET: h(agentCard.GET) } },
  { pattern: /^\/api\/exchange\/a2a$/, methods: { POST: h(a2a.POST) } },
  { pattern: /^\/api\/exchange\/a2a\/v1\/(.+)$/, methods: { GET: h(a2aRest.GET), POST: h(a2aRest.POST) }, params: (m) => ({ path: m[1].split("/").map(decodeURIComponent) }) },
  { pattern: /^\/api\/exchange\/tasks\/([^/]+)\/decision$/, methods: { POST: h(decision.POST) }, params: (m) => ({ id: decodeURIComponent(m[1]) }) },
  { pattern: /^\/api\/exchange\/tasks\/([^/]+)$/, methods: { GET: h(task.GET) }, params: (m) => ({ id: decodeURIComponent(m[1]) }) },
  { pattern: /^\/api\/exchange\/ingest$/, methods: { POST: h(ingest.POST) } },
  { pattern: /^\/api\/exchange\/intents$/, methods: { GET: h(intents.GET) } },
  { pattern: /^\/api\/exchange\/ledger$/, methods: { GET: h(ledger.GET) } },
  { pattern: /^\/api\/exchange\/mandate$/, methods: { GET: h(mandate.GET), PUT: h(mandate.PUT) } },
  { pattern: /^\/api\/exchange\/node$/, methods: { GET: h(node.GET) } },
  { pattern: /^\/api\/exchange\/peers$/, methods: { GET: h(peers.GET) } },
  { pattern: /^\/api\/exchange\/pulse$/, methods: { GET: h(pulse.GET) } },
  { pattern: /^\/api\/exchange\/status$/, methods: { GET: h(status.GET) } },
  { pattern: /^\/api\/exchange\/stream$/, methods: { GET: h(stream.GET) } },
];

export async function handle(req: Request): Promise<Response> {
  const path = new URL(req.url).pathname.replace(/\/+$/, "") || "/";
  for (const r of ROUTES) {
    const m = path.match(r.pattern);
    if (!m) continue;
    const fn = r.methods[req.method.toUpperCase()];
    if (!fn) return new Response(null, { status: 405, headers: { Allow: Object.keys(r.methods).join(", ") } });
    return fn(req, { params: Promise.resolve(r.params?.(m) ?? {}) });
  }
  return Response.json({ error: { code: -32601, message: `No Bloom Exchange endpoint at ${path}` } }, { status: 404 });
}

/** A `fetch` that serves Bloom Exchange in-process: point any SDK or MCP client at it. */
export const inProcessFetch: typeof fetch = (input, init) => handle(input instanceof Request ? input : new Request(input, init));
