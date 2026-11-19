/**
 * The origin a node names itself by, in Agent Cards and in every receipt it signs.
 *
 *   BLOOM_EXCHANGE_PUBLIC_URL          the node's public origin, e.g. https://node.example. Validated: it must be
 *                                      a bare http(s) origin, because every route lives at the root and the value
 *                                      is written into signed receipts, where a typo would be permanent.
 *   BLOOM_EXCHANGE_REQUIRE_PUBLIC_URL  1 = refuse binding negotiations until the URL is set (see gateway.ts).
 *
 * Unset, the node uses each request's own origin (its Host header), and a production process warns once.
 */
export class PublicUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicUrlError";
  }
}

/** Parses a configured public URL into a bare origin, or throws a PublicUrlError that says what to fix. */
export function parsePublicUrl(raw: string): string {
  const fail = (why: string) => new PublicUrlError(`BLOOM_EXCHANGE_PUBLIC_URL must be a bare http(s) origin such as https://node.example: ${why} (got ${JSON.stringify(raw.slice(0, 120))}).`);
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw fail("not a URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw fail(`scheme ${u.protocol} is not http or https`);
  if (u.username || u.password) throw fail("it carries credentials");
  if (u.pathname !== "/" || u.search || u.hash) throw fail("it has a path, query or fragment, but every route lives at the origin's root");
  return u.origin;
}

let parsed: { raw: string; origin: string } | null = null;

/** The validated configured origin, "" when unset. Throws on an invalid value, on every call until it is fixed. */
function configuredPublicUrl(): string {
  const raw = process.env.BLOOM_EXCHANGE_PUBLIC_URL?.trim() ?? "";
  if (!raw) return "";
  if (parsed?.raw !== raw) parsed = { raw, origin: parsePublicUrl(raw) };
  return parsed.origin;
}

/** For startup hooks: throws a PublicUrlError when BLOOM_EXCHANGE_PUBLIC_URL is set but invalid. */
export function assertPublicUrlConfig(): void {
  configuredPublicUrl();
}

/** Whether the node names itself by BLOOM_EXCHANGE_PUBLIC_URL ("configured") or by each request's Host header. */
export const publicUrlSource = (): "configured" | "request-host" => (configuredPublicUrl() ? "configured" : "request-host");

/** BLOOM_EXCHANGE_REQUIRE_PUBLIC_URL=1: refuse binding negotiations until BLOOM_EXCHANGE_PUBLIC_URL is set. */
export const publicUrlRequired = () => /^(1|true|on|yes)$/i.test(process.env.BLOOM_EXCHANGE_REQUIRE_PUBLIC_URL?.trim() ?? "");

// Once per process, not per route bundle (Next bundles each route separately), hence globalThis.
const warnState = globalThis as typeof globalThis & { __bloomPublicUrlWarned?: boolean };

/**
 * The origin this node names itself by: BLOOM_EXCHANGE_PUBLIC_URL when set (and valid), else the request's own
 * origin. The one rule for Agent Cards, receipts and every other self-reference. A production process without the
 * variable prints one warning; one with an invalid value fails every request until it is fixed, rather than
 * signing a malformed URL into a receipt.
 */
export function publicOrigin(req: Request): string {
  const configured = configuredPublicUrl();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production" && !warnState.__bloomPublicUrlWarned) {
    warnState.__bloomPublicUrlWarned = true;
    console.warn(
      "[bloom] BLOOM_EXCHANGE_PUBLIC_URL is not set: Agent Cards and receipts name this node by each request's Host header, so a receipt records whatever host its client used. Set it to the node's public origin (BLOOM_EXCHANGE_REQUIRE_PUBLIC_URL=1 refuses binding negotiations until you do).",
    );
  }
  return new URL(req.url).origin;
}
