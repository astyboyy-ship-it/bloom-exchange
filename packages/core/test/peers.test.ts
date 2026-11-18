import { afterEach, describe, expect, it } from "vitest";
import { GET as cardRoute } from "../src/http/agent-card";
import { GET as peersRoute } from "../src/http/peers";
import { inProcessFetch } from "../src/http/router";
import { configuredPeers, discoverPeer, verifyCardSignature } from "../src/peers";

afterEach(() => {
  delete process.env.BLOOM_PEERS;
});

const card = async () => (await cardRoute(new Request("http://alpha.test/.well-known/agent-card.json")).json()) as Record<string, unknown>;

describe("peer discovery", () => {
  it("verifies a node's signed Agent Card with node:crypto alone", async () => {
    const c = await card();
    expect(verifyCardSignature(c)).toMatch(/^bxk-[0-9a-f]{16}$/);
  });

  it("rejects a card altered after signing", async () => {
    const c = await card();
    expect(verifyCardSignature({ ...c, name: "Impostor Exchange" })).toBeNull();
  });

  it("parses BLOOM_PEERS and discovers each peer's verified identity and endpoint", async () => {
    process.env.BLOOM_PEERS = " http://beta.test/ , not-a-url ,http://gamma.test";
    expect(configuredPeers()).toEqual(["http://beta.test", "http://gamma.test"]);
    const d = await discoverPeer("http://beta.test", inProcessFetch);
    expect(d).toMatchObject({ verified: true, name: "Bloom Exchange", endpoint: "http://beta.test/api/exchange/a2a" });
    const down = await discoverPeer("http://down.test", async () => new Response("no", { status: 503 }));
    expect(down).toMatchObject({ verified: false, error: "agent card answered 503" });
  });

  it("serves the node's own identity and its peers at /api/exchange/peers", async () => {
    const body = (await (await peersRoute()).json()) as { self: { kid: string }; peers: unknown[] };
    expect(body.self.kid).toMatch(/^bxk-/);
    expect(body.peers).toEqual([]);
  });
});
