/**
 * Canonical JSON (RFC 8785 style: sorted keys, no whitespace, undefined members dropped). Every hash and
 * signature in Bloom Exchange covers this form, and the SDK reimplements it byte for byte.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonicalize: non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalize(v))).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  throw new Error(`canonicalize: unsupported ${typeof value}`);
}

/** The exact fields a round hash covers. */
export const roundPayload = (r: { n: number; by: string; terms: unknown; message: string; at: string; prevHash: string }) =>
  canonicalize({ n: r.n, by: r.by, terms: r.terms, message: r.message, at: r.at, prevHash: r.prevHash });

export const GENESIS = "0".repeat(64);

/** The string a certificate's Ed25519 signature and HMAC seal cover. */
export const signingInput = (digest: string) => `BLOOM-XCH-SIG-v1\n${digest}`;

/** Crockford base32, used for the human-readable certificate id. */
export function base32(bytes: Uint8Array): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let bits = 0;
  let acc = 0;
  let out = "";
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(acc << (5 - bits)) & 31];
  return out;
}

/** BLOOM-XCH-XXXX-XXXX-XXXX-XXXX from the hex digest of the certificate's identity fields. */
export function certificateIdFrom(hex: string): string {
  const bytes = new Uint8Array(10);
  for (let i = 0; i < 10; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const s = base32(bytes);
  return `BLOOM-XCH-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
}

export const certificateIdInput = (taskId: string, chainHead: string, issuedAt: string) => `BLOOM-XCH|${taskId}|${chainHead}|${issuedAt}`;
