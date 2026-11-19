import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentKey, commitMandate, RelayTransport, signReceipt } from "@bloom-exchange/sdk";
import { withPrice, type DataRetrievalTerms } from "@bloom-exchange/schemas";
import { bootRelay } from "../../../tests/relay-harness.ts";
import { createBloomMcpServer } from "../src/server.ts";

/** The bloom_* network tools against a real local relay: publish, discover with reputation, verify a cleared receipt. */
let relay: Awaited<ReturnType<typeof bootRelay>>;
let client: Client;
let mcpKey: AgentKey;

const spec: DataRetrievalTerms = { vertical: "data.retrieval", datasetId: "openalex/works", queryHashSha256: "ab".repeat(32), maxAgeSeconds: 86_400, licenseTier: "commercial", totalPriceAtomic: "5000000", currency: "USDC" };

beforeAll(async () => {
  relay = await bootRelay();
  mcpKey = await AgentKey.generate();
  const server = createBloomMcpServer({ baseUrl: "http://localhost:3000", relayUrl: relay.url, verifierUrl: "https://verify.bloomexchange.ai", agentSeed: mcpKey.exportSeed() });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "network-client", version: "0.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
});
afterAll(async () => {
  await client.close();
  await relay.close();
});

type Out = { structuredContent?: Record<string, unknown>; isError?: boolean; content: { text: string }[] };
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as Out;

describe("MCP network tools", () => {
  it("lists bloom_publish_intent, bloom_discover_counterparties and bloom_verify_receipt", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["bloom_publish_intent", "bloom_discover_counterparties", "bloom_verify_receipt"]));
  });

  it("publishes an intent signed with the configured agent key", async () => {
    const r = await call("bloom_publish_intent", { vertical: "data.retrieval", role: "seller", capabilityTags: ["openalex"], spec, ttlSeconds: 600 });
    expect(r.isError).toBeFalsy();
    const out = r.structuredContent as { intent: { owner: string; vertical: string }; agent: { pubkey: string; note?: string } };
    expect(out.intent).toMatchObject({ owner: mcpKey.publicKey, vertical: "data.retrieval" });
    expect(out.agent.note).toBeUndefined(); // the key is configured, not ephemeral
    const bad = await call("bloom_publish_intent", { vertical: "data.retrieval", role: "seller", spec: { ...spec, totalPriceAtomic: "50.00" } });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toMatch(/Relay refused \(422 invalid_intent\)/);
  });

  it("discovers counterparties with their reputation and passport links", async () => {
    const r = await call("bloom_discover_counterparties", { vertical: "data.retrieval", tag: "openalex" });
    const cps = (r.structuredContent as { counterparties: { owner: { pubkey: string; completedDeals: number; passport: string } }[] }).counterparties;
    expect(cps).toHaveLength(1);
    expect(cps[0].owner).toMatchObject({ pubkey: mcpKey.publicKey, completedDeals: 0, passport: `https://verify.bloomexchange.ai/a/${mcpKey.publicKey}` });
  });

  it("verifies a cleared receipt by hash and returns a shareable link", async () => {
    // A buyer agent clears a deal with the MCP agent (as seller) through the relay directly.
    const seller = new RelayTransport({ baseUrl: relay.url, key: mcpKey });
    const buyer = new RelayTransport({ baseUrl: relay.url, key: await AgentKey.generate() });
    const [intent] = await buyer.discoverIntents({ vertical: "data.retrieval" });
    const bm = await commitMandate({ vertical: "data.retrieval", role: "buyer", currency: "USDC", limitAtomic: "4800000" });
    const sm = await commitMandate({ vertical: "data.retrieval", role: "seller", currency: "USDC", limitAtomic: "4000000" });
    const { room } = await buyer.openRoom({ intentId: intent.id, terms: withPrice(spec, "4500000"), mandateCommitment: bm.commitment });
    await seller.sendEvent(room.id, { type: "ACCEPT", mandateCommitment: sm.commitment });
    const { receipt, hash } = await buyer.prepareReceipt(room.id);
    await buyer.sendEvent(room.id, { type: "CLEAR", receipt: receipt as unknown as Record<string, unknown>, signatures: { buyer: await signReceipt(buyer.key, hash), seller: await signReceipt(mcpKey, hash) } });

    const v = await call("bloom_verify_receipt", { hash, openings: [bm.opening] });
    expect(v.structuredContent).toMatchObject({ valid: true, hash, priceAtomic: "4500000", currency: "USDC", verifyUrl: `https://verify.bloomexchange.ai/r/${hash}`, checks: { buyerSignature: "pass", sellerSignature: "pass", ledgerInclusion: "pass", mandateBounds: "pass" } });
    const missing = await call("bloom_verify_receipt", { hash: "0".repeat(64) });
    expect(missing.isError).toBe(true);
  });

  it("generates an ephemeral key when none is configured, and says so", async () => {
    const server = createBloomMcpServer({ baseUrl: "http://localhost:3000", relayUrl: relay.url });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const c = new Client({ name: "ephemeral", version: "0" });
    await Promise.all([server.connect(a), c.connect(b)]);
    const r = (await c.callTool({ name: "bloom_publish_intent", arguments: { vertical: "data.retrieval", role: "buyer", spec, ttlSeconds: 600 } })) as Out;
    expect((r.structuredContent as { agent: { note?: string } }).agent.note).toMatch(/BLOOM_AGENT_SEED/);
    await c.close();
  });
});
