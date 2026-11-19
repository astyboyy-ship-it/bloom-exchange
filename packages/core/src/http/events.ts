import { A2A_HEADERS, callerFor, limitCaller } from "../gateway.ts";
import { exchangeKeys } from "../crypto.ts";
import { eventHub } from "../events/hub.ts";
import { isBloomEventType, type BloomEvent, type BloomEventType } from "../events/types.ts";

export const OPTIONS = () => new Response(null, { status: 204, headers: { ...A2A_HEADERS, "Access-Control-Allow-Headers": `${A2A_HEADERS["Access-Control-Allow-Headers"]}, Last-Event-ID` } });

const refuse = (status: number, message: string) => Response.json({ error: { message } }, { status, headers: A2A_HEADERS });

/**
 * The node's Bloom event feed (opt-in: BLOOM_EVENTS=1, or enableEvents() in code).
 *
 *   GET /api/exchange/events?cursor=<c>&limit=50&types=negotiation.settled,receipt.issued
 *       JSON page: { events, cursor, reset, hasMore }. Poll again with the returned cursor.
 *   GET /api/exchange/events?stream=1   (or Accept: text/event-stream)
 *       SSE: replays from the cursor (or Last-Event-ID), then pushes live events for up to 100 s.
 *       Each frame's `id:` is its cursor, so a reconnecting EventSource resumes exactly.
 *
 * Scope: the Operator access key sees every environment. Any other caller sees sandbox events only, which
 * matches GetTask, where sandbox tasks are readable by anyone. Events never carry mandate figures in any scope.
 */
export async function GET(req: Request) {
  const hub = eventHub();
  if (!hub) return refuse(404, "The event feed is off on this node. Start it with BLOOM_EVENTS=1.");
  const caller = await callerFor(req);
  const limit = await limitCaller(caller);
  if (!limit.ok) return refuse(429, "Rate limit reached.");

  const url = new URL(req.url);
  const rawTypes = (url.searchParams.get("types") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = rawTypes.filter((t) => !isBloomEventType(t));
  if (unknown.length) return refuse(400, `Unknown event type: ${unknown.join(", ").slice(0, 120)}`);
  const types = rawTypes as BloomEventType[];
  const where = caller.operator ? undefined : (e: BloomEvent) => e.environment === "sandbox";
  const cursor = url.searchParams.get("cursor") ?? req.headers.get("last-event-id");
  const pageSize = Number(url.searchParams.get("limit") ?? 50);
  const scope = caller.operator ? "all" : "sandbox";

  const wantsStream = url.searchParams.get("stream") === "1" || (req.headers.get("accept") ?? "").includes("text/event-stream");
  if (!wantsStream) {
    const page = hub.read({ cursor, limit: Number.isFinite(pageSize) ? pageSize : 50, types, where });
    return Response.json({ ...page, scope, node: { kid: exchangeKeys().jwk.kid } }, { headers: A2A_HEADERS });
  }

  const encoder = new TextEncoder();
  const typeSet = types.length ? new Set<string>(types) : null;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      let last = 0;
      const write = (s: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          open = false;
        }
      };
      const frame = (e: BloomEvent) => {
        if (e.seq <= last) return;
        last = e.seq;
        write(`id: ${e.cursor}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      };
      // Subscribe first and buffer, so nothing published during the replay is lost.
      const buffered: BloomEvent[] = [];
      let replaying = true;
      const unsubscribe = hub.subscribe((e) => {
        if ((typeSet && !typeSet.has(e.type)) || (where && !where(e))) return;
        if (replaying) buffered.push(e);
        else frame(e);
      });
      let page = hub.read({ cursor, limit: 200, types, where });
      if (page.reset) write(`event: reset\ndata: ${JSON.stringify({ reset: true, cursor: page.cursor })}\n\n`);
      for (;;) {
        page.events.forEach(frame);
        if (!page.hasMore) break;
        page = hub.read({ cursor: page.cursor, limit: 200, types, where });
      }
      replaying = false;
      buffered.forEach(frame);
      const keepAlive = setInterval(() => write(": keep-alive\n\n"), 15_000);
      const close = () => {
        if (!open) return;
        open = false;
        clearInterval(keepAlive);
        clearTimeout(timer);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      const timer = setTimeout(close, 100_000);
      req.signal.addEventListener("abort", close);
    },
  });
  return new Response(body, { headers: { ...A2A_HEADERS, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
