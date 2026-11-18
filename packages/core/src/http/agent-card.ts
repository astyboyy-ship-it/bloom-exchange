import { agentCard } from "../agent-card";
import { A2A_HEADERS } from "../gateway";


export const OPTIONS = () => new Response(null, { status: 204, headers: A2A_HEADERS });

/** A2A discovery: Bloom Exchange's signed Agent Card. */
export function GET(req: Request) {
  const origin = process.env.BLOOM_EXCHANGE_PUBLIC_URL?.trim().replace(/\/$/, "") || new URL(req.url).origin;
  return Response.json(agentCard(origin), { headers: { ...A2A_HEADERS, "Cache-Control": "public, max-age=300" } });
}
