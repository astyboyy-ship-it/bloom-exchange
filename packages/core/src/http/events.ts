import { A2A_HEADERS, callerFor } from "../gateway.ts";
import { rateLimit } from "../guard/rate-limit.ts";
import { exchangeKeys } from "../crypto.ts";
import { eventHub } from "../events/hub.ts";
import { isBloomEventType, type BloomEvent, type BloomEventType } from "../events/types.ts";

export const OPTIONS = () => new Response(null, { status: 204, headers: { ...A2A_HEADERS, "Access-Control-Allow-Headers": `${A2A_HEADERS["Access-Control-Allow-Headers"]}, Last-Event-ID` } });

const refuse = (status: number, message: string) => Response.json({ error: { message } }, { status, headers: A2A_HEADERS });

/** A reader this far behind is dropped rather than buffered without bound; it reconnects from its last id. */
const MAX_BACKLOG = 1_000;
const MAX_TASK_IDS = 100;
const READS_PER_MINUTE = 120;
const TASK_ID = /^xch_[\w-]{10,40}$/;
const STREAM_MS = 100_000;

/**
 * The node's Bloom event feed (opt-in: BLOOM_EVENTS=1, or enableEvents() in code).
 *
 *   GET /api/exchange/events?cursor=<c>&limit=50&types=negotiation.settled,receipt.issued
 *       JSON page: { events, cursor, reset, hasMore, scope }. Poll again with the returned cursor.
 *   GET /api/exchange/events?stream=1   (or Accept: text/event-stream)
 *       SSE: replays from the cursor (or Last-Event-ID), then pushes live events for up to 100 s.
 *       Each frame's `id:` is its cursor, so a reconnecting EventSource resumes exactly.
 *
 *   &taskId=xch_…[,xch_…]  (up to 100) the tasks the caller holds ids for, exactly as GetTask accepts them
 *
 * Scope (EventHub.visibleTo): the Operator access key sees every event; an access-key holder its own tasks;
 * anyone the sandbox tasks whose ids it presents. Operator-side events (clamps, exception kinds) only in the sandbox.
 */
export async function GET(req: Request) {
  const hub = eventHub();
  if (!hub) return refuse(404, "The event feed is off on this node. Start it with BLOOM_EVENTS=1.");
  const caller = await callerFor(req);
  // Feed reads have their own budget: sharing the negotiation bucket (10/min anonymous) let a 2 s watcher starve
  // the same caller's negotiations.
  const limit = await rateLimit("events", caller.decision.identity, READS_PER_MINUTE);
  if (!limit.ok) return refuse(429, "Rate limit reached.");

  const url = new URL(req.url);
  const rawTypes = (url.searchParams.get("types") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (rawTypes.some((t) => !isBloomEventType(t))) return refuse(400, "Unknown event type.");
  const types = rawTypes as BloomEventType[];
  const taskIds = new Set(
    url.searchParams
      .getAll("taskId")
      .flatMap((v) => v.split(","))
      .map((s) => s.trim())
      .filter((s) => TASK_ID.test(s)),
  );
  if (taskIds.size > MAX_TASK_IDS) return refuse(400, `At most ${MAX_TASK_IDS} task ids per request.`);
  const visible = hub.visibleTo(caller.operator ? { operator: true } : { operator: false, owner: caller.owner, licensed: caller.licensed, taskIds });
  // Presented ids narrow the page to those tasks for every reader; they never widen what `visible` allows.
  const where = taskIds.size ? (e: BloomEvent) => taskIds.has(e.taskId) && (visible?.(e) ?? true) : visible;
  const cursor = url.searchParams.get("cursor") ?? req.headers.get("last-event-id");
  const pageSize = Number(url.searchParams.get("limit") ?? 50);
  const scope = caller.operator ? "all" : caller.licensed ? "own" : "tasks";

  const wantsStream = url.searchParams.get("stream") === "1" || (req.headers.get("accept") ?? "").includes("text/event-stream");
  if (!wantsStream) {
    const page = hub.read({ cursor, limit: Number.isFinite(pageSize) ? pageSize : 50, types, where });
    const adapters = caller.operator ? { adapters: hub.registry.list(), disabled: hub.disabled, deadLetters: hub.registry.deadLetters().length } : {};
    return Response.json({ ...page, scope, node: { kid: exchangeKeys().jwk.kid }, ...adapters }, { headers: A2A_HEADERS });
  }

  const encoder = new TextEncoder();
  const typeSet = types.length ? new Set<string>(types) : null;
  let close = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      let last = 0;
      const write = (s: string) => {
        if (!open) return;
        if ((controller.desiredSize ?? 0) < -MAX_BACKLOG) return close();
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          close();
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
      const keepAlive = setInterval(() => write(": keep-alive\n\n"), 15_000);
      const timer = setTimeout(() => close(), STREAM_MS);
      close = () => {
        if (!open) return;
        open = false;
        clearInterval(keepAlive);
        clearTimeout(timer);
        unsubscribe();
        req.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          // already closed or canceled
        }
      };
      req.signal.addEventListener("abort", close);

      let page = hub.read({ cursor, limit: 200, types, where });
      if (page.reset) write(`event: reset\ndata: ${JSON.stringify({ reset: true, cursor: page.cursor })}\n\n`);
      for (;;) {
        page.events.forEach(frame);
        if (!page.hasMore || !open) break;
        page = hub.read({ cursor: page.cursor, limit: 200, types, where });
      }
      replaying = false;
      buffered.forEach(frame);
    },
    // The consumer went away (client disconnect in most hosts): release the subscription and timers now.
    cancel() {
      close();
    },
  });
  return new Response(body, { headers: { ...A2A_HEADERS, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
