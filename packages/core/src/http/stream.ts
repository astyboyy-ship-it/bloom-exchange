import { A2A_HEADERS, callerFor, limitCaller, mayViewOperator, replay, sseResponse } from "../gateway";
import { listTraffic, loadTask } from "../store";


export const OPTIONS = () => new Response(null, { status: 204, headers: A2A_HEADERS });

const refuse = (status: number, message: string) => Response.json({ error: { message } }, { status, headers: A2A_HEADERS });

/**
 * Real-time SSE telemetry.
 *   ?taskId=xch_…[&view=operator]  replays one enclave's events, then follows it live until it settles
 *   ?scope=traffic                 the provider's traffic radar (handshakes, blocks, settlements): operator key only
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const caller = await callerFor(req);
  const limit = await limitCaller(caller);
  if (!limit.ok) return refuse(429, "Rate limit reached.");

  if (url.searchParams.get("scope") === "traffic") {
    if (!caller.operator) return refuse(403, "The traffic radar needs an Operator access key.");
    return sseResponse(async (send) => {
      const seen = new Set<string>();
      const until = Date.now() + 100_000;
      while (Date.now() < until && !req.signal.aborted) {
        const fresh = (await listTraffic(40)).filter((e) => !seen.has(`${e.at}|${e.taskId}|${e.kind}`)).reverse();
        for (const e of fresh) {
          seen.add(`${e.at}|${e.taskId}|${e.kind}`);
          send({ type: "traffic", event: e });
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    });
  }

  const id = url.searchParams.get("taskId") ?? "";
  const rec = await loadTask(id);
  if (!rec || (rec.environment !== "sandbox" && rec.owner !== caller.owner && !caller.operator)) return refuse(404, "Task not found.");
  const operator = url.searchParams.get("view") === "operator" && mayViewOperator(caller, rec);
  return sseResponse((send) => replay(rec.id, operator, send, req.signal));
}
