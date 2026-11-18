import { z } from "zod";
import { A2A_HEADERS, callerFor, limitCaller } from "../gateway";
import { processIntent } from "../intent-store";


export const OPTIONS = () => new Response(null, { status: 204, headers: A2A_HEADERS });

const Body = z
  .object({
    protocol: z.string().trim().min(1).max(40),
    payload: z.unknown().optional(),
    source: z.string().trim().max(60).optional(),
    goal: z.string().trim().max(1000).optional(),
  })
  .strict();

const fail = (status: number, message: string, details?: unknown) => Response.json({ error: { message, details } }, { status, headers: A2A_HEADERS });

/**
 * Omni-protocol ingestion: POST any surface's payload (or just a source name and a goal) and it is normalized into an
 * AgentIntentNode, screened by Shield, sealed, clamped by Sovereign and cleared. Returns the finished node with its
 * stage trace and, when it settled, the certificate id (the full certificate is at /api/exchange/tasks/{taskId}).
 */
export async function POST(req: Request) {
  const caller = await callerFor(req);
  const limit = await limitCaller(caller);
  if (!limit.ok) return fail(429, "Rate limit reached. Retry in a minute.");
  const text = await req.text();
  if (text.length > 32_768) return fail(413, "Payload too large (32 KB max).");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail(400, "Body must be valid JSON.");
  }
  const body = Body.safeParse(raw);
  if (!body.success) return fail(422, "Send { protocol, payload?, source?, goal? }.", body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  if (body.data.payload === undefined && !body.data.goal) return fail(422, "Send a payload, a goal, or both.");
  return Response.json(await processIntent(caller, body.data), { headers: A2A_HEADERS });
}
