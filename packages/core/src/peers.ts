import { createPublicKey, verify } from "node:crypto";
import { canonicalize } from "./canonical";

/**
 * Peer discovery between Bloom nodes. A node lists its peers in BLOOM_PEERS (comma-separated base URLs) and, on
 * request, fetches each peer's /.well-known/agent-card.json and verifies its detached EdDSA JWS against the key
 * the card publishes in its settlement extension (SPEC §3). Only public information is returned: the peer's name,
 * organization, A2A endpoint and key id, and whether its card verifies.
 */
export type PeerDiscovery = {
  url: string;
  verified: boolean;
  name: string | null;
  organization: string | null;
  kid: string | null;
  endpoint: string | null;
  error?: string;
};

type Card = {
  name?: string;
  provider?: { organization?: string };
  supportedInterfaces?: { url: string; protocolBinding: string }[];
  capabilities?: { extensions?: { uri: string; params?: { jwks?: { keys?: { kid: string; x: string }[] } } }[] };
  signatures?: { protected: string; signature: string }[];
};

export const configuredPeers = (env: NodeJS.ProcessEnv = process.env): string[] =>
  (env.BLOOM_PEERS ?? "")
    .split(",")
    .map((u) => u.trim().replace(/\/+$/, ""))
    .filter((u) => /^https?:\/\//.test(u));

/** Verifies an Agent Card's detached JWS against its own published Ed25519 key. Returns the signing kid or null. */
export function verifyCardSignature(card: Card): string | null {
  const sig = card.signatures?.[0];
  if (!sig) return null;
  let header: { alg?: string; kid?: string };
  try {
    header = JSON.parse(Buffer.from(sig.protected, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const keys = card.capabilities?.extensions?.find((e) => e.uri.includes("/settlement/"))?.params?.jwks?.keys ?? [];
  const key = keys.find((k) => k.kid === header.kid);
  if (!key || header.alg !== "EdDSA") return null;
  const unsigned: Record<string, unknown> = { ...card };
  delete unsigned.signatures;
  const payload = Buffer.from(canonicalize(unsigned)).toString("base64url");
  try {
    const pub = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: key.x }, format: "jwk" });
    return verify(null, Buffer.from(`${sig.protected}.${payload}`, "utf8"), pub, Buffer.from(sig.signature, "base64url")) ? key.kid : null;
  } catch {
    return null;
  }
}

export async function discoverPeer(url: string, f: typeof fetch = fetch): Promise<PeerDiscovery> {
  const base: PeerDiscovery = { url, verified: false, name: null, organization: null, kid: null, endpoint: null };
  try {
    const res = await f(`${url}/.well-known/agent-card.json`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return { ...base, error: `agent card answered ${res.status}` };
    const card = (await res.json()) as Card;
    const kid = verifyCardSignature(card);
    return {
      url,
      verified: kid !== null,
      name: card.name ?? null,
      organization: card.provider?.organization ?? null,
      kid,
      endpoint: card.supportedInterfaces?.find((i) => i.protocolBinding === "JSONRPC")?.url ?? null,
      ...(kid === null && { error: "agent card signature does not verify" }),
    };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }
}
