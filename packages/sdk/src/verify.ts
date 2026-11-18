import { canonicalize, certificateIdFrom, certificateIdInput, GENESIS, signingInput } from "./canonical.ts";
import type { AgentCard, Credential, Jwk, SettlementCertificate, VerificationResult } from "./types.ts";

/**
 * Offline verification with Web Crypto only (Node 20+, Deno, Bun, modern browsers). A certificate is valid when
 * its digest matches its canonical body, its id derives from its chain head, every round hash recomputes and
 * links, its Ed25519 signature verifies under the Agent Card's published key, and both AP2 credentials' proofs do.
 */

const enc = new TextEncoder();

function bytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return Array.from(d, (x) => x.toString(16).padStart(2, "0")).join("");
}

async function ed25519Verify(jwk: Jwk, signature: string, message: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: jwk.x }, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, bytes(signature), enc.encode(message));
  } catch {
    return false;
  }
}

/** The Ed25519 keys an Agent Card publishes in its Bloom settlement extension. */
export function cardKeys(card: AgentCard): Jwk[] {
  const ext = card.capabilities?.extensions?.find((e) => e.uri.includes("/settlement/"));
  const jwks = ext?.params?.jwks as { keys?: Jwk[] } | undefined;
  return Array.isArray(jwks?.keys) ? jwks.keys : [];
}

/** Checks the card's detached JWS against its own published key: proves the card is intact as served. */
export async function verifyAgentCard(card: AgentCard): Promise<{ valid: boolean; kid: string | null }> {
  const sig = card.signatures?.[0];
  if (!sig) return { valid: false, kid: null };
  let header: { alg?: string; kid?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(bytes(sig.protected)));
  } catch {
    return { valid: false, kid: null };
  }
  const key = cardKeys(card).find((k) => k.kid === header.kid);
  if (!key || header.alg !== "EdDSA") return { valid: false, kid: header.kid ?? null };
  const unsigned: Record<string, unknown> = { ...card };
  delete unsigned.signatures;
  const payload = btoa(String.fromCharCode(...enc.encode(canonicalize(unsigned)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { valid: await ed25519Verify(key, sig.signature, `${sig.protected}.${payload}`), kid: key.kid };
}

async function verifyCredential(c: Credential, keys: Jwk[]): Promise<boolean> {
  const kid = c.proof?.verificationMethod?.split("#")[1];
  const key = keys.find((k) => k.kid === kid);
  if (!key) return false;
  const { proofValue, ...proofBase } = c.proof;
  return ed25519Verify(key, proofValue, canonicalize({ ...c, proof: proofBase }));
}

export async function verifyCertificate(cert: SettlementCertificate, keys: Jwk[]): Promise<VerificationResult> {
  const checks = { digest: false, certificateId: false, chain: false, signature: false, ap2Proofs: false };
  try {
    const { digest, signature } = cert;
    const body: Record<string, unknown> = { ...cert };
    delete body.digest;
    delete body.signature;
    delete body.seal;
    checks.digest = (await sha256Hex(canonicalize(body))) === digest;

    const chain = cert.rounds.chain;
    let prev = chain[0]?.prevHash ?? GENESIS;
    let chainOk = chain.length > 0 && chain.length === cert.rounds.count;
    for (const r of chain) {
      const h = await sha256Hex(canonicalize({ n: r.n, by: r.by, terms: r.terms, message: r.message, at: r.at, prevHash: r.prevHash }));
      if (r.prevHash !== prev || h !== r.hash) chainOk = false;
      prev = r.hash;
    }
    checks.chain = chainOk && prev === cert.rounds.chainHead;
    checks.certificateId = certificateIdFrom(await sha256Hex(certificateIdInput(cert.taskId, cert.rounds.chainHead, cert.issuedAt))) === cert.certificateId;

    const key = keys.find((k) => k.kid === signature.kid);
    checks.signature = Boolean(key) && signature.alg === "EdDSA" && (await ed25519Verify(key!, signature.value, signingInput(digest)));
    checks.ap2Proofs = (await verifyCredential(cert.ap2.checkoutMandate, keys)) && (await verifyCredential(cert.ap2.paymentMandate, keys));
  } catch (err) {
    return { valid: false, checks, reason: err instanceof Error ? err.message : "malformed certificate" };
  }
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  return { valid: failed.length === 0, checks, ...(failed.length && { reason: `failed: ${failed.join(", ")}` }) };
}
