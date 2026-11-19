import { afterEach, describe, expect, it, vi } from "vitest";
import { publicOrigin } from "../src/gateway";
import { assertPublicUrlConfig, parsePublicUrl, PublicUrlError } from "../src/public-url";
import { POST as a2a } from "../src/http/a2a";
import { GET as node } from "../src/http/node";
import { handle } from "../src/http/router";
import { DEV_SIGNING_SECRET, signAccessKey } from "../src/licensing/codec";
import { ROLE_DEFAULTS, ROLE_TIER } from "../src/licensing/types";
import type { NodeStatus } from "../src/node-status";
import { BUYER, ITEM, SELLER } from "./fixtures";

/**
 * Public URL guardrails (audit #1). Without BLOOM_EXCHANGE_PUBLIC_URL a node names itself by each request's Host
 * header, and a receipt records that host. Production warns once; /api/exchange/node reports the source; strict
 * mode refuses binding negotiations until the URL is set. Sandbox and demo flows are never affected.
 */
const ENV = ["NODE_ENV", "BLOOM_EXCHANGE_PUBLIC_URL", "BLOOM_EXCHANGE_REQUIRE_PUBLIC_URL"] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

async function licensedKey() {
  const b = ROLE_DEFAULTS.enterprise;
  return signAccessKey({ keyId: "ent_public_url", holderName: "Public URL test", role: "enterprise", tier: ROLE_TIER.enterprise, unlockedEngines: b.unlockedEngines, themeConfig: b.theme, permissions: b.permissions, issuedAt: new Date().toISOString(), expiresAt: null }, DEV_SIGNING_SECRET);
}

let ip = 0;
/** A negotiation; `sandbox: true` opts into a private sandbox, otherwise a licensed caller clears in production. */
async function negotiate(opts: { key?: string; sandbox?: boolean; messageId?: string } = {}) {
  const bloomExchange = { intent: "negotiate", mandate: BUYER, item: ITEM, ...(opts.sandbox && { sandbox: { initiatorMandate: SELLER } }) };
  const res = await a2a(
    new Request("http://localhost:3000/api/exchange/a2a", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": `10.44.0.${++ip}`, ...(opts.key && { "x-bloom-license": opts.key }) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "SendMessage", params: { message: { messageId: opts.messageId ?? crypto.randomUUID(), role: "user", parts: [{ kind: "data", data: { bloomExchange } }] } } }),
    }),
  );
  return { status: res.status, json: (await res.json()) as { result?: { status: { state: string }; metadata: Record<string, unknown> }; error?: { code: number; message: string } } };
}

const posture = async () => ((await (await node(new Request("http://localhost:3000/api/exchange/node", { headers: { "x-forwarded-for": "10.44.9.9" } }))).json()) as NodeStatus).posture;

describe("public URL guardrails", () => {
  it("warns once per production process when the public URL is derived, and never otherwise", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const req = new Request("http://internal-host:3000/x");
    delete process.env.BLOOM_EXCHANGE_PUBLIC_URL;
    // Development and tests: silent.
    expect(publicOrigin(req)).toBe("http://internal-host:3000");
    expect(warn).not.toHaveBeenCalled();
    // Production with the URL configured: silent, and the configured origin wins over Host.
    process.env.NODE_ENV = "production";
    process.env.BLOOM_EXCHANGE_PUBLIC_URL = "https://node.example/";
    expect(publicOrigin(req)).toBe("https://node.example");
    expect(warn).not.toHaveBeenCalled();
    // Production, derived: one warning, however many requests follow.
    delete process.env.BLOOM_EXCHANGE_PUBLIC_URL;
    for (let i = 0; i < 5; i++) expect(publicOrigin(req)).toBe("http://internal-host:3000");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/BLOOM_EXCHANGE_PUBLIC_URL is not set/);
  });

  it("accepts only a bare http(s) origin, and fails fast on a typo instead of signing it into receipts", () => {
    for (const ok of [["https://node.example", "https://node.example"], ["https://Node.Example/", "https://node.example"], ["http://127.0.0.1:3001", "http://127.0.0.1:3001"]]) expect(parsePublicUrl(ok[0])).toBe(ok[1]);
    for (const bad of ["node.example", "https//node.example", "ftp://node.example", "javascript:alert(1)", "https://user:pw@node.example", "https://node.example/bloom", "https://node.example/?x=1", "https://node.example/#a", "http://"]) {
      expect(() => parsePublicUrl(bad), bad).toThrow(PublicUrlError);
    }
    process.env.BLOOM_EXCHANGE_PUBLIC_URL = "node.example"; // the classic typo: no scheme
    expect(() => assertPublicUrlConfig()).toThrow(/must be a bare http\(s\) origin/);
    expect(() => publicOrigin(new Request("http://localhost:3000/x"))).toThrow(PublicUrlError);
    process.env.BLOOM_EXCHANGE_PUBLIC_URL = "https://node.example";
    expect(() => assertPublicUrlConfig()).not.toThrow();
    delete process.env.BLOOM_EXCHANGE_PUBLIC_URL;
    expect(() => assertPublicUrlConfig()).not.toThrow(); // unset is allowed: the node derives it (and warns)
  });

  it("never lets an invalid URL reach a card or a receipt: the request fails instead", async () => {
    process.env.BLOOM_EXCHANGE_PUBLIC_URL = "https://node.example/typo/path";
    const card = await handle(new Request("http://localhost:3000/.well-known/agent-card.json")).catch((e: unknown) => e);
    expect(card instanceof Response ? card.status : "threw").not.toBe(200);
    // The handler throws before any enclave exists; a host turns that into a generic HTTP 500.
    const deal = await negotiate().catch((e: unknown) => e);
    if (deal instanceof Error) expect(deal).toBeInstanceOf(PublicUrlError);
    else {
      expect((deal as Awaited<ReturnType<typeof negotiate>>).json.result).toBeUndefined();
      expect(JSON.stringify(deal)).not.toContain("typo/path");
    }
  });

  it("reports on /api/exchange/node whether the public URL is configured or derived from Host", async () => {
    delete process.env.BLOOM_EXCHANGE_PUBLIC_URL;
    expect(await posture()).toMatchObject({ publicUrl: "request-host", publicUrlRequired: false });
    process.env.BLOOM_EXCHANGE_PUBLIC_URL = "https://node.example";
    process.env.BLOOM_EXCHANGE_REQUIRE_PUBLIC_URL = "1";
    expect(await posture()).toMatchObject({ publicUrl: "configured", publicUrlRequired: true });
  });

  it("strict mode refuses binding negotiations while the URL is derived, without burning the idempotency key", async () => {
    delete process.env.BLOOM_EXCHANGE_PUBLIC_URL;
    process.env.BLOOM_EXCHANGE_REQUIRE_PUBLIC_URL = "1";
    const key = await licensedKey();
    const messageId = crypto.randomUUID();
    // JSON-RPC carries method errors in a 200 envelope; the REST binding maps the same error to HTTP 503.
    const refused = await negotiate({ key, messageId });
    expect(refused.json.error?.code).toBe(-32053);
    expect(refused.json.error?.message).toMatch(/BLOOM_EXCHANGE_PUBLIC_URL/);
    expect(refused.json.result).toBeUndefined();
    const rest = await handle(
      new Request("http://localhost:3000/api/exchange/a2a/v1/message:send", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "10.44.8.8", "x-bloom-license": key },
        body: JSON.stringify({ message: { messageId: crypto.randomUUID(), role: "user", parts: [{ kind: "data", data: { bloomExchange: { intent: "negotiate", mandate: BUYER, item: ITEM } } }] } }),
      }),
    );
    expect(rest.status).toBe(503);

    // The operator sets the URL; the client's retry with the same message id now clears, binding.
    process.env.BLOOM_EXCHANGE_PUBLIC_URL = "https://node.example";
    const cleared = await negotiate({ key, messageId });
    expect(cleared.status).toBe(200);
    expect(cleared.json.result?.metadata["bloom.environment"]).toBe("production");
  });

  it("strict mode leaves sandbox and demo flows alone", async () => {
    delete process.env.BLOOM_EXCHANGE_PUBLIC_URL;
    process.env.BLOOM_EXCHANGE_REQUIRE_PUBLIC_URL = "1";
    const anonymous = await negotiate();
    expect(anonymous.status).toBe(200);
    expect(anonymous.json.result?.metadata["bloom.environment"]).toBe("sandbox");
    const licensedSandbox = await negotiate({ key: await licensedKey(), sandbox: true });
    expect(licensedSandbox.status).toBe(200);
    expect(licensedSandbox.json.result?.metadata["bloom.environment"]).toBe("sandbox");
  });

  it("is off by default: binding negotiations clear with a derived URL, as before", async () => {
    delete process.env.BLOOM_EXCHANGE_PUBLIC_URL;
    delete process.env.BLOOM_EXCHANGE_REQUIRE_PUBLIC_URL;
    const res = await negotiate({ key: await licensedKey() });
    expect(res.status).toBe(200);
    expect(res.json.result?.metadata["bloom.environment"]).toBe("production");
  });
});
