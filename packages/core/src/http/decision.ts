import { z } from "zod";
import { decideException } from "../enclave.ts";
import { A2A_HEADERS, callerFor, mayViewOperator } from "../gateway.ts";
import { operatorView } from "../projection.ts";
import { loadTask } from "../store.ts";


const Body = z.object({ action: z.enum(["override", "reject"]) }).strict();

/** Exception queue: the provider's executive overrides (settles, recorded on the certificate) or rejects. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const caller = await callerFor(req);
  const rec = await loadTask(id);
  if (!rec || !mayViewOperator(caller, rec)) return Response.json({ error: { message: "Task not found." } }, { status: 404, headers: A2A_HEADERS });
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = null;
  }
  const body = Body.safeParse(raw);
  if (!body.success) return Response.json({ error: { message: 'Body must be {"action":"override"|"reject"}.' } }, { status: 422, headers: A2A_HEADERS });
  const by = caller.operator ? (caller.license.access?.holderName ?? caller.license.label) : "sandbox-operator";
  try {
    return Response.json(operatorView(await decideException(rec, body.data.action, by)), { headers: A2A_HEADERS });
  } catch (err) {
    return Response.json({ error: { message: err instanceof Error ? err.message : "Decision failed." } }, { status: 409, headers: A2A_HEADERS });
  }
}
