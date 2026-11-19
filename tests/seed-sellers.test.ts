import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentKey, clampPrice, commitMandate, RelayTransport, signReceipt } from "@bloom-exchange/sdk";
import { withPrice, type Terms } from "@bloom-exchange/schemas";
import { PROFILES, ReferenceSeller, relayAllowed } from "../scripts/seed-sellers.ts";
import { bootRelay } from "./relay-harness.ts";

/** The reference sellers against a real local relay: they publish, find rooms, concede to a floor, sign and clear. */
let relay: Awaited<ReturnType<typeof bootRelay>>;
beforeAll(async () => {
  relay = await bootRelay();
});
afterAll(() => relay.close());

describe("reference sellers (mock liquidity)", () => {
  it("refuse a non-local relay unless --live is given", () => {
    expect(relayAllowed("http://localhost:8787", false)).toEqual({ ok: true });
    expect(relayAllowed("http://127.0.0.1:9000", false)).toEqual({ ok: true });
    expect(relayAllowed("https://relay.bloomexchange.ai", false)).toMatchObject({ ok: false });
    expect(relayAllowed("https://relay.bloomexchange.ai", true)).toEqual({ ok: true });
    expect(relayAllowed("not a url", true)).toMatchObject({ ok: false });
  });

  it("publish labeled intents for all three verticals", async () => {
    for (const p of Object.values(PROFILES)) {
      const s = new ReferenceSeller(new RelayTransport({ baseUrl: relay.url, key: await AgentKey.generate() }), p);
      await s.start();
    }
    const found = await new RelayTransport({ baseUrl: relay.url, key: await AgentKey.generate() }).discoverIntents({ tag: "reference-liquidity" });
    expect(new Set(found.map((i) => i.vertical))).toEqual(new Set(["api.inference", "data.retrieval", "compute.gpu"]));
    const rep = await new RelayTransport({ baseUrl: relay.url, key: await AgentKey.generate() }).getReputation(found[0].owner);
    expect(rep.org).toBe("Bloom Exchange reference liquidity");
  });

  it("negotiates with a buyer down toward its sealed floor, never below it, and clears", async () => {
    const seller = new ReferenceSeller(new RelayTransport({ baseUrl: relay.url, key: await AgentKey.generate() }), PROFILES["compute.gpu"]);
    await seller.start();
    const buyer = new RelayTransport({ baseUrl: relay.url, key: await AgentKey.generate() });
    const [intent] = (await buyer.discoverIntents({ vertical: "compute.gpu", tag: "reference-liquidity" })).filter((i) => i.owner === seller.relay.key.publicKey);
    const bm = await commitMandate({ vertical: "compute.gpu", role: "buyer", currency: "USD", limitAtomic: "2000000" });
    const spec = intent.spec as unknown as Terms;
    const { room } = await buyer.openRoom({ intentId: intent.id, terms: withPrice(spec, "1200000"), mandateCommitment: bm.commitment, maxRounds: 6 });

    let bid = 1_200_000n;
    for (let i = 0; i < 12; i++) {
      await seller.step();
      const { room: r } = await buyer.getRoom(room.id);
      if (r.status !== "COUNTERED" || r.lastOffer?.by === buyer.key.publicKey) {
        if (r.status !== "COUNTERED") break;
        continue;
      }
      const ask = BigInt(r.lastOffer!.priceAtomic);
      expect(ask >= 1_750_000n).toBe(true); // the seller's floor holds on every offer
      if (ask <= 2_000_000n && r.rounds >= 3) {
        await buyer.sendEvent(room.id, { type: "ACCEPT" });
        break;
      }
      bid = BigInt(clampPrice(((bid + ask) / 2n).toString(), bm.opening.mandate));
      await buyer.sendEvent(room.id, { type: "COUNTER", terms: withPrice(spec, bid.toString()) });
    }
    const accepted = (await buyer.getRoom(room.id)).room;
    expect(accepted.status).toBe("ACCEPTED");
    const { hash } = await buyer.prepareReceipt(room.id);
    await buyer.sendEvent(room.id, { type: "SIGN", signature: await signReceipt(buyer.key, hash) });
    await seller.step(); // signs and clears
    const final = (await buyer.getRoom(room.id)).room;
    expect(final.status).toBe("CLEARED");
    const v = await buyer.verifyReceipt(final.receiptHash!, [bm.opening]);
    expect(v.valid).toBe(true);
    expect(BigInt(v.payload.receipt.priceAtomic) >= 1_750_000n).toBe(true);
    expect(BigInt(v.payload.receipt.priceAtomic) <= 2_000_000n).toBe(true);
  });
});
