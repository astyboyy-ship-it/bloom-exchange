import { A2A_HEADERS, callerFor } from "../gateway";
import { nodeStatus } from "../node-status";


/** The node this terminal is connected to: mode, root fingerprint and egress posture; hardware and audit for the operator. */
export async function GET(req: Request) {
  return Response.json(await nodeStatus(await callerFor(req)), { headers: A2A_HEADERS });
}
