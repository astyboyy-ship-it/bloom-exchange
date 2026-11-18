/** Canonical JSON: sorted keys, no whitespace, undefined members dropped. Byte-identical to the server's. */
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

export const GENESIS = "0".repeat(64);
export const signingInput = (digest: string) => `BLOOM-XCH-SIG-v1\n${digest}`;
export const certificateIdInput = (taskId: string, chainHead: string, issuedAt: string) => `BLOOM-XCH|${taskId}|${chainHead}|${issuedAt}`;

export function certificateIdFrom(hex: string): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let bits = 0;
  let acc = 0;
  let s = "";
  for (let i = 0; i < 10; i++) {
    acc = (acc << 8) | parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    bits += 8;
    while (bits >= 5) {
      s += alphabet[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return `BLOOM-XCH-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
}
