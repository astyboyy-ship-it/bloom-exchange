import { agentCard } from "../agent-card.ts";
import { A2A_HEADERS } from "../gateway.ts";


export const OPTIONS = () => new Response(null, { status: 204, headers: A2A_HEADERS });

/** A2A discovery: Bloom Exchange's signed Agent Card. */
export function GET(req: Request) {
  const origin = process.env.BLOOM_EXCHANGE_PUBLIC_URL?.trim().replace(/\/$/, "") || new URL(req.url).origin;
  return Response.json(agentCard(origin), { headers: { ...A2A_HEADERS, "Cache-Control": "public, max-age=300" } });
}
