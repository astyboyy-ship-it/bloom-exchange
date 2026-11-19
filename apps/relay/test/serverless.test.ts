import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRequestListener } from "@hono/node-server";
import { AgentKey, authHeaders, commitMandate, RelayTransport, signRequest, type RoomEvent } from "@bloom-exchange/sdk";
import { withPrice, type ApiInferenceTerms } from "@bloom-exchange/schemas";
import { createRelay } from "../src/app.ts";
import { MemoryNonceStore } from "../src/nonce.ts";
import { MemoryStore } from "../src/store/memory.ts";
import { vercelHandler } from "../src/vercel.ts";

/**
 * The relay as it runs on Vercel: no WebSocket server, Node's (req, res) adapter, and many instances that share only
 * the store. A subscriber streaming from one instance must still see moves made through another.
 */
const listen = (handler: Parameters<typeof createServer>[1]) =>
  new Promise<{ url: string; server: Server }>((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server }));
  });

const spec: ApiInferenceTerms = { vertical: "api.inference", model: "m", maxInputTokens: 1000, maxOutputTokens: 100, latencySlaMs: 500, unitPriceAtomic: "100", currency: "USD" };
const servers: Server[] = [];
let a: string;
let b: string;

beforeAll(async () => {
  // Two "invocations" of the same deployment: separate apps and buses, one shared store and nonce store.
  const store = new MemoryStore();
  const nonces = new MemoryNonceStore();
  const instance = () => createRelay({ store, nonces, publicUrl: "https://relay.example", streamMs: 20_000, storePollMs: 200 });
  const [sa, sb] = await Promise.all([listen(getRequestListener(instance().app.fetch)), listen(getRequestListener(instance().app.fetch))]);
  servers.push(sa.server, sb.server);
  a = sa.url;
  b = sb.url;
});
afterAll(() => {
  for (const s of servers) {
    s.closeAllConnections();
    s.close();
  }
});

describe("relay on serverless (Vercel's Node adapter, no WebSocket)", () => {
  it("advertises SSE and polling, not WebSocket, when no server attaches WebSocket streams", async () => {
    const h = (await (await fetch(`${a}/health`)).json()) as { transports: string[] };
    expect(h.transports).toEqual(["sse", "poll"]);
  });

  it("streams a move made through another instance to an SSE subscriber on this one", async () => {
    const seller = new RelayTransport({ baseUrl: b, key: await AgentKey.generate() });
    const buyer = new RelayTransport({ baseUrl: b, key: await AgentKey.generate() });
    const intent = await seller.publishIntent({ vertical: "api.inference", role: "seller", capabilityTags: [], spec, ttlSeconds: 600 });
    const { room } = await buyer.openRoom({ intentId: intent.id, terms: withPrice(spec, "60"), mandateCommitment: (await commitMandate({ vertical: "api.inference", role: "buyer", currency: "USD", limitAtomic: "90" })).commitment });

    // The seller subscribes through instance A in auto mode: WebSocket fails there, so it must settle on SSE.
    const onA = new RelayTransport({ baseUrl: a, key: seller.key });
    const seen: RoomEvent[] = [];
    const sub = onA.subscribeRoom(room.id, (e) => seen.push(e));
    // Moves go through instance B, whose in-process bus instance A never hears.
    await seller.sendEvent(room.id, { type: "COUNTER", terms: withPrice(spec, "80"), mandateCommitment: (await commitMandate({ vertical: "api.inference", role: "seller", currency: "USD", limitAtomic: "70" })).commitment });
    await buyer.sendEvent(room.id, { type: "ACCEPT" });
    const until = Date.now() + 10_000;
    while (seen.length < 3 && Date.now() < until) await new Promise((r) => setTimeout(r, 25));
    sub.close();
    expect(sub.mode).toBe("sse");
    expect(seen.map((e) => e.type)).toEqual(["PROPOSE", "COUNTER", "ACCEPT"]);
  }, 20_000);

  it("verifies signatures over the raw request target through the Node adapter (path and query unchanged)", async () => {
    const key = await AgentKey.generate();
    const target = "/v1/rooms?status=PROPOSED,COUNTERED&limit=5";
    const ok = await fetch(`${a}${target}`, { headers: authHeaders(await signRequest(key, "GET", target)) });
    expect(ok.status).toBe(200);
    const reordered = await fetch(`${a}/v1/rooms?limit=5&status=PROPOSED,COUNTERED`, { headers: authHeaders(await signRequest(key, "GET", target)) });
    expect(reordered.status).toBe(401);
  });
});

describe("the Vercel entry (vercelHandler)", () => {
  it("serves the relay from environment configuration", async () => {
    const { url, server } = await listen(vercelHandler({ NODE_ENV: "test", RELAY_PUBLIC_URL: "https://bloom-exchange-relay.vercel.app" }));
    servers.push(server);
    const h = (await (await fetch(`${url}/health`)).json()) as { ok: boolean; transports: string[]; store: string };
    expect(h).toMatchObject({ ok: true, store: "memory", transports: ["sse", "poll"] });
  });

  it("answers every request with a 503 naming the problem when production configuration is missing, instead of crashing", async () => {
    const { url, server } = await listen(vercelHandler({ NODE_ENV: "production" }));
    servers.push(server);
    for (const path of ["/health", "/v1/intents"]) {
      const res = await fetch(`${url}${path}`);
      expect(res.status).toBe(503);
      expect(((await res.json()) as { error: { code: string; message: string } }).error).toMatchObject({ code: "misconfigured", message: expect.stringMatching(/DATABASE_URL is required/) });
    }
  });

  it("takes its public origin from Vercel's production URL when RELAY_PUBLIC_URL is unset", async () => {
    const { url, server } = await listen(vercelHandler({ NODE_ENV: "test", VERCEL_PROJECT_PRODUCTION_URL: "bloom-exchange-relay.vercel.app" }));
    servers.push(server);
    const seller = new RelayTransport({ baseUrl: url, key: await AgentKey.generate() });
    const buyer = new RelayTransport({ baseUrl: url, key: await AgentKey.generate() });
    const intent = await seller.publishIntent({ vertical: "api.inference", role: "seller", capabilityTags: [], spec, ttlSeconds: 600 });
    const { room } = await buyer.openRoom({ intentId: intent.id, terms: spec, mandateCommitment: "a".repeat(64) });
    expect(room.relay).toBe("https://bloom-exchange-relay.vercel.app");
  });
});
