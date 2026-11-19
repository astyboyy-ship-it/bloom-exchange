import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Outbound-request guard for webhook adapters.
 *
 *   1. Exact-origin allowlist: the target's origin must equal one listed origin (scheme, host and port).
 *   2. HTTPS only, except plain HTTP to a loopback host (localhost, 127.0.0.0/8, ::1) for local development.
 *   3. No credentials in the URL.
 *   4. DNS check: every address the host resolves to must be public, so an allowlisted name that resolves (or
 *      rebinds) to a private, link-local, metadata or loopback address is refused. A loopback host must
 *      resolve to loopback only.
 * The adapter then connects to the validated address itself (no second lookup) and never follows redirects.
 */
export type LookupFn = (hostname: string) => Promise<{ address: string; family: number }[]>;
export const systemLookup: LookupFn = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

export type Target = { url: URL; host: string; loopback: boolean };
export type Resolved = { address: string; family: 4 | 6 };

const bare = (hostname: string) => hostname.replace(/^\[|\]$/g, "").toLowerCase();

function v4(ip: string): number[] | null {
  const p = ip.split(".").map(Number);
  return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? p : null;
}

function v4Private([a, b]: number[]): boolean {
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast, reserved, broadcast
  );
}

/** Expands an IPv6 literal to eight 16-bit groups (handles `::` and an embedded IPv4 tail). */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) {
    const q = v4(tail[1]);
    if (!q) return null;
    s = s.slice(0, -tail[1].length) + `${((q[0] << 8) | q[1]).toString(16)}:${((q[2] << 8) | q[3]).toString(16)}`;
  }
  const [head, rest] = s.split("::");
  if (s.split("::").length > 2) return null;
  const h = head ? head.split(":") : [];
  const r = rest !== undefined ? (rest ? rest.split(":") : []) : null;
  const groups = r === null ? h : [...h, ...Array(8 - h.length - r.length).fill("0"), ...r];
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.every((n) => !Number.isNaN(n)) ? nums : null;
}

export function isPrivateAddress(ip: string): boolean {
  const addr = bare(ip);
  const kind = isIP(addr);
  if (kind === 4) return v4Private(v4(addr)!);
  if (kind !== 6) return true; // not an address at all: refuse
  const g = v6Groups(addr);
  if (!g) return true;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): judge the embedded IPv4 address.
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return v4Private([g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255]);
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x0064 && g[1] === 0xff9b) return true; // NAT64 (can reach internal IPv4)
  return false;
}

export function isLoopbackAddress(ip: string): boolean {
  const addr = bare(ip);
  if (isIP(addr) === 4) return v4(addr)![0] === 127;
  const g = isIP(addr) === 6 ? v6Groups(addr) : null;
  if (!g) return false;
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true;
  return g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff && g[6] >> 8 === 127;
}

const isLoopbackHost = (host: string) => host === "localhost" || host.endsWith(".localhost") || (isIP(host) !== 0 && isLoopbackAddress(host));

export function normalizeOrigin(origin: string): string {
  const u = new URL(origin);
  if (u.pathname !== "/" || u.search || u.hash || u.username || u.password) throw new Error(`Allowlist entries must be bare origins (scheme://host[:port]): ${origin}`);
  return u.origin;
}

/** Static checks: scheme, credentials, allowlist. Throws with a reason a configuration error can show. */
export function checkTarget(raw: string, allow: readonly string[]): Target {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Webhook URL is not a valid URL.");
  }
  if (url.username || url.password) throw new Error("Webhook URL must not carry credentials.");
  const host = bare(url.hostname);
  const loopback = isLoopbackHost(host);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("Webhook URL must use https (plain http is allowed only to a loopback host).");
  if (!allow.length) throw new Error("Webhook needs an explicit origin allowlist.");
  const origins = new Set(allow.map(normalizeOrigin));
  if (!origins.has(url.origin)) throw new Error(`Webhook origin ${url.origin} is not on the allowlist.`);
  return { url, host, loopback };
}

/** Resolves the host and checks every address. Returns the one address to connect to. */
export async function resolveTarget(t: Target, lookup: LookupFn = systemLookup): Promise<Resolved> {
  let addrs: { address: string; family: number }[];
  if (isIP(t.host)) addrs = [{ address: t.host, family: isIP(t.host) }];
  else {
    try {
      addrs = await lookup(t.host);
    } catch {
      throw new Error(`DNS lookup failed for ${t.host}.`);
    }
  }
  if (!addrs.length) throw new Error(`${t.host} did not resolve.`);
  for (const a of addrs) {
    if (t.loopback ? !isLoopbackAddress(a.address) : isPrivateAddress(a.address)) {
      throw new Error(t.loopback ? `${t.host} resolved to a non-loopback address.` : `${t.host} resolved to a private or reserved address (${a.address}).`);
    }
  }
  const first = addrs[0];
  return { address: bare(first.address), family: first.family === 6 ? 6 : 4 };
}
