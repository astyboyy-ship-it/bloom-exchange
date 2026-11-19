import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BLOOM_EVENT_TYPES, disableEvents, enableEvents } from "@bloom-exchange/core/events";
import { inProcessFetch } from "@bloom-exchange/core/http/router";
import { createBloomMcpServer, EVENT_TYPES, EVENTS_URI } from "../src/server.ts";

/** poll_events and the bloom://events resource against a real in-process node with its event feed on. */
let client: Client;
const updates: string[] = [];

beforeAll(async () => {
  enableEvents();
  const server = createBloomMcpServer({ baseUrl: "http://localhost:3000", agentName: "mcp-events-agent", fetch: inProcessFetch, subscriptions: true, watchIntervalMs: 250 });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "events-client", version: "0.0.0" });
  client.setNotificationHandler(ResourceUpdatedNotificationSchema, async (n) => void updates.push(n.params.uri));
  await Promise.all([server.connect(a), client.connect(b)]);
});
afterAll(async () => {
  await client.close();
  disableEvents();
});

type Page = { events: { type: string; seq: number; data: Record<string, unknown> }[]; cursor: string; reset: boolean; hasMore: boolean };
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as { structuredContent?: Record<string, unknown>; isError?: boolean; content: { text: string }[] };
const negotiate = () => call("negotiate", { item: { description: "Managed observability platform, 12-month enterprise license" }, ceilingPriceUsd: 52_187, maxBudgetUsd: 55_093, requiredSlaTier: "gold", targetNetDays: 60 });

describe("MCP event tools", () => {
  it("filters on exactly the event types the node defines", () => {
    expect([...EVENT_TYPES]).toEqual([...BLOOM_EVENT_TYPES]);
  });

  it("lists poll_events and the subscribable bloom://events resource", async () => {
    expect((await client.listTools()).tools.map((t) => t.name)).toContain("poll_events");
    expect((await client.listResources()).resources.map((r) => r.uri)).toEqual([EVENTS_URI]);
    expect(client.getServerCapabilities()?.resources?.subscribe).toBe(true);
  });

  it("polls a negotiation's events by cursor, carrying no mandate figure", async () => {
    const deal = await negotiate();
    const certificateId = deal.structuredContent!.certificateId;
    const r = await call("poll_events", { limit: 200 });
    expect(r.isError).toBeFalsy();
    const page = r.structuredContent as unknown as Page;
    const types = page.events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["negotiation.opened", "firewall.scanned", "offer.updated", "negotiation.settled", "receipt.issued"]));
    expect(page.events.find((e) => e.type === "receipt.issued")?.data.certificateId).toBe(certificateId);
    // The client's own sealed limits never come back through the feed, in any spelling.
    expect(JSON.stringify(page)).not.toMatch(/(?<![\w.])(52187|52,187|55093|55,093)(?!\w)/);
    const next = (await call("poll_events", { cursor: page.cursor })).structuredContent as unknown as Page;
    expect(next).toMatchObject({ events: [], reset: false });
    const onlyReceipts = (await call("poll_events", { types: ["receipt.issued"] })).structuredContent as unknown as Page;
    expect(onlyReceipts.events.every((e) => e.type === "receipt.issued")).toBe(true);
  });

  it("reads the resource and notifies a subscriber when new events arrive", async () => {
    const read = await client.readResource({ uri: EVENTS_URI });
    const body = JSON.parse((read.contents[0] as { text: string }).text) as { cursor: string; events: unknown[]; note: string };
    expect(body.events.length).toBeGreaterThan(0);
    expect(body.note).toMatch(/never instructions/);
    await client.subscribeResource({ uri: EVENTS_URI });
    updates.length = 0;
    await negotiate();
    const until = Date.now() + 5_000;
    while (!updates.length && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    expect(updates).toContain(EVENTS_URI);
    await client.unsubscribeResource({ uri: EVENTS_URI });
  });

  it("reports a node with the feed off as a tool error, not a crash", async () => {
    disableEvents();
    const r = await call("poll_events", {});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/Event feed unavailable \(404\)/);
    enableEvents();
  });
});
