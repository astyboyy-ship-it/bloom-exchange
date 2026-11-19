import { agentCard } from "../agent-card.ts";
import { A2A_HEADERS, publicOrigin } from "../gateway.ts";


export const OPTIONS = () => new Response(null, { status: 204, headers: A2A_HEADERS });

/** A2A discovery: Bloom Exchange's signed Agent Card. */
export function GET(req: Request) {
  return Response.json(agentCard(publicOrigin(req)), { headers: { ...A2A_HEADERS, "Cache-Control": "public, max-age=300" } });
}
