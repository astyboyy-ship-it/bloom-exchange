import { A2A_HEADERS, callerFor, mayViewOperator } from "../gateway.ts";
import { operatorView } from "../projection.ts";
import { loadTask } from "../store.ts";


/**
 * The provider's full view of one enclave (the certificate inspector's data): its own mandate, Apex proposals,
 * Sovereign clamps, Shield audit and Aether proof. Never the client's limits. Operator key, or a sandbox enclave.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const caller = await callerFor(req);
  const rec = await loadTask(id);
  if (!rec || !mayViewOperator(caller, rec)) return Response.json({ error: { message: "Task not found." } }, { status: 404, headers: A2A_HEADERS });
  return Response.json(operatorView(rec), { headers: A2A_HEADERS });
}
