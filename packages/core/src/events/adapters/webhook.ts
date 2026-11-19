import { createHmac, timingSafeEqual } from "node:crypto";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { checkTarget, resolveTarget, systemLookup, type LookupFn, type Target } from "../ssrf.ts";
import { BLOOM_EVENT_TYPES, type AdapterCheck, type BloomEvent, type BloomEventType, type DeliveryContext, type DeliveryResult, type EventAdapter } from "../types.ts";

/**
 * Local webhook / HTTP callback adapter (built). POSTs each redacted event as JSON.
 *
 * Guardrails: exact-origin allowlist, https (or http to loopback), every resolved address checked against
 * private ranges, the connection pinned to the checked address (no second DNS lookup, so no rebinding window),
 * redirects never followed, a hard timeout, a body cap. The response is handled by status code only: its body
 * is never read, parsed or logged, so nothing a receiver sends back can reach the node.
 *
 * Headers: Bloom-Event-Id, Bloom-Event-Type, Idempotency-Key (the event id), and with a secret
 * `Bloom-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>` (verify with verifyEventSignature).
 */
export type WebhookOptions = {
  url: string;
  /** Exact origins (scheme://host[:port]) this adapter may call. Required. */
  allow: readonly string[];
  /** HMAC secret for Bloom-Signature. Optional; without it requests are unsigned. */
  secret?: string;
  events?: readonly BloomEventType[] | "*";
  id?: string;
  timeoutMs?: number;
  /** DNS resolver (tests inject one). */
  lookup?: LookupFn;
};

const MAX_BODY = 64 * 1024;

class DnsTimeout extends Error {}

export function signEventBody(body: string, secret: string, timestamp: number): string {
  return `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

/** For receivers: checks a Bloom-Signature header against the raw body, with a freshness window. */
export function verifyEventSignature(body: string, header: string | null | undefined, secret: string, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)): boolean {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header ?? "");
  if (!m || Math.abs(nowSec - Number(m[1])) > toleranceSec) return false;
  const expected = Buffer.from(signEventBody(body, secret, Number(m[1])).split("v1=")[1], "hex");
  const got = Buffer.from(m[2], "hex");
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export class WebhookAdapter implements EventAdapter {
  readonly id: string;
  readonly name = "Webhook (HTTP callback)";
  readonly events: readonly BloomEventType[] | "*";
  private readonly target: Target;
  private readonly secret?: string;
  private readonly timeoutMs: number;
  private readonly lookup: LookupFn;

  constructor(opts: WebhookOptions) {
    this.target = checkTarget(opts.url, opts.allow); // throws on a bad configuration, before any event
    this.id = opts.id ?? "webhook";
    this.secret = opts.secret;
    this.events = opts.events ?? "*";
    if (this.events !== "*" && this.events.some((t) => !(BLOOM_EVENT_TYPES as readonly string[]).includes(t))) throw new Error("Unknown event type in webhook filter.");
    this.timeoutMs = Math.min(Math.max(opts.timeoutMs ?? 4_000, 100), 4_000);
    this.lookup = opts.lookup ?? systemLookup;
  }

  async check(): Promise<AdapterCheck> {
    try {
      const r = await resolveTarget(this.target, this.lookup);
      return { ok: true, detail: `${this.target.url.origin} resolves to an allowed address (${r.address}); nothing was sent.` };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  async deliver(event: BloomEvent, ctx: DeliveryContext): Promise<DeliveryResult> {
    const body = JSON.stringify(event);
    if (Buffer.byteLength(body) > MAX_BODY) return { ok: false, retryable: false, reason: "event body exceeds 64 KiB" };
    // One deadline covers DNS and the request: a hung resolver cannot stretch an attempt past the timeout.
    const deadline = Date.now() + this.timeoutMs;
    let resolved;
    let dnsTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const slow = new Promise<never>((_, reject) => (dnsTimer = setTimeout(() => reject(new DnsTimeout()), this.timeoutMs)));
      resolved = await Promise.race([resolveTarget(this.target, this.lookup), slow]);
    } catch (err) {
      if (err instanceof DnsTimeout) return { ok: false, retryable: true, reason: `timed out after ${this.timeoutMs} ms` };
      return { ok: false, retryable: false, reason: `blocked: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      clearTimeout(dnsTimer);
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(body)),
      "User-Agent": "bloom-exchange-events/0.2",
      "Bloom-Event-Id": event.id,
      "Bloom-Event-Type": event.type,
      "Idempotency-Key": ctx.idempotencyKey,
      ...(this.secret && { "Bloom-Signature": signEventBody(body, this.secret, Math.floor(Date.now() / 1000)) }),
    };
    // Connect to the address we just checked: the request never performs a lookup of its own.
    const pinned: LookupFunction = (_host, options, cb) => {
      if (options.all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: resolved.address, family: resolved.family }]);
      else cb(null, resolved.address, resolved.family);
    };
    const url = this.target.url;
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;

    const status = await new Promise<number | Error>((resolve) => {
      // hostname (not the IP) drives the Host header and TLS certificate checks; `lookup` pins the address.
      // agent: false gives every delivery its own socket, so nothing is pooled across checked addresses.
      // SNI must be a name (RFC 6066), so an IP-literal https URL sends none and the certificate is checked
      // against the IP.
      const req = send(
        { protocol: url.protocol, hostname: this.target.host, port: url.port || undefined, path: `${url.pathname}${url.search}`, method: "POST", headers, lookup: pinned, agent: false, ...(url.protocol === "https:" && !isIP(this.target.host) && { servername: this.target.host }) },
        (res: IncomingMessage) => {
          const code = res.statusCode ?? 0;
          res.destroy(); // status only: the body is untrusted and never read
          resolve(code);
        },
      );
      const timer = setTimeout(() => req.destroy(new Error("timeout")), Math.max(1, deadline - Date.now()));
      req.on("error", (err) => resolve(err));
      req.on("close", () => clearTimeout(timer));
      req.end(body);
    });

    if (status instanceof Error) return { ok: false, retryable: true, reason: status.message === "timeout" ? `timed out after ${this.timeoutMs} ms` : "connection failed" };
    if (status >= 200 && status < 300) return { ok: true };
    if (status >= 300 && status < 400) return { ok: false, retryable: false, reason: `redirect not followed (status ${status})` };
    if (status === 429 || status >= 500) return { ok: false, retryable: true, reason: `receiver answered ${status}` };
    return { ok: false, retryable: false, reason: `receiver answered ${status}` };
  }
}
