import { exchangeKeys } from "../crypto.ts";
import { A2A_HEADERS } from "../gateway.ts";
import { configuredPeers, discoverPeer } from "../peers.ts";

/** This node's identity and its configured peers, each with its signed Agent Card verified (public data only). */
export async function GET() {
  const keys = exchangeKeys();
  const peers = await Promise.all(configuredPeers().map((u) => discoverPeer(u)));
  return Response.json(
    { self: { organization: process.env.BLOOM_NODE_ORG?.trim() || "Bloom AI", kid: keys.jwk.kid }, peers },
    { headers: { ...A2A_HEADERS, "Cache-Control": "no-store" } },
  );
}
