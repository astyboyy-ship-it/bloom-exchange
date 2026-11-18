import { describe, expect, it } from "vitest";
import { buildApexPrompt, deterministicApex, type Proposer } from "../src/bloom-bridge";
import { provisionEnclave, runEnclave } from "../src/enclave";
import { operatorView, toA2ATask } from "../src/projection";
import { privateFigures, scrubLeaks, sealVault } from "../src/vault";
import { BUYER, buyerSecrets, ITEM, LOWBALL_BUYER, rpc, SELLER, sellerSecrets, sendParams, sseFrames } from "./fixtures";
import { POST as a2a } from "../src/http/a2a";
import { rpcRequest } from "./fixtures";

const noneMatch = (text: string, patterns: RegExp[]) => patterns.filter((p) => p.test(text)).map(String);

function enclave(buyer = BUYER) {
  return provisionEnclave({ owner: "test", environment: "sandbox", source: "simulated", origin: "http://localhost:3000", peerName: "acme", framework: "custom", item: ITEM, preferredRail: "stripe", initiator: SELLER, counterparty: buyer, message: "We need gold SLA.", probes: 0 });
}

describe("zero mandate leakage", () => {
  it("never puts the provider's private figures in a JSON-RPC response", async () => {
    for (const buyer of [BUYER, LOWBALL_BUYER]) {
      const { text, json } = await rpc("SendMessage", sendParams({ buyer }));
      expect(json.result?.kind).toBe("task");
      expect(noneMatch(text, sellerSecrets())).toEqual([]);
    }
  });

  it("never puts them in a streamed response either, round by round", async () => {
    const res = await a2a(rpcRequest({ jsonrpc: "2.0", id: "s", method: "SendStreamingMessage", params: sendParams() }));
    const { raw, frames } = await sseFrames(res);
    expect(frames.length).toBeGreaterThan(5);
    expect(noneMatch(raw, sellerSecrets())).toEqual([]);
  });

  it("keeps operator telemetry out of an external stream even when asked for it", async () => {
    // A licensed-looking but unentitled caller asking for the operator view of a production task gets public events only;
    // a sandbox caller may see its own operator events, which still never carry the counterparty's limits.
    const res = await a2a(rpcRequest({ jsonrpc: "2.0", id: "s", method: "SendStreamingMessage", params: sendParams() }, { "x-bloom-view": "operator" }));
    const { raw } = await sseFrames(res);
    expect(noneMatch(raw, buyerSecrets(BUYER))).toEqual([]);
  });

  it("gives the provider's operator view no counterparty limits", async () => {
    for (const buyer of [BUYER, LOWBALL_BUYER]) {
      const rec = await runEnclave(enclave(buyer), { apex: deterministicApex });
      expect(noneMatch(JSON.stringify(operatorView(rec)), buyerSecrets(buyer))).toEqual([]);
    }
  });

  it("builds every Apex prompt from the provider's side only", async () => {
    const prompts: string[] = [];
    const spy: Proposer = async (ctx) => {
      const p = buildApexPrompt(ctx);
      prompts.push(p.system, p.user, JSON.stringify(ctx));
      return deterministicApex(ctx);
    };
    await runEnclave(enclave(), { apex: spy });
    expect(prompts.length).toBeGreaterThan(3);
    for (const p of prompts) expect(noneMatch(p, buyerSecrets(BUYER))).toEqual([]);
  });

  it("redacts a model that tries to disclose the floor, cost basis or margin", async () => {
    const leaky: Proposer = async (ctx) => ({
      terms: ctx.plan,
      message: `Honestly our floor is $41,373 (41373), cost basis 29,411, about $41.4k, we need a 27.5% margin and auto-settle up to 75013.`,
      model: "test/leaky",
    });
    const rec = await runEnclave(enclave(), { apex: leaky });
    const external = JSON.stringify(toA2ATask(rec));
    expect(noneMatch(external, sellerSecrets())).toEqual([]);
    expect(external).toContain("[sealed]");
    expect(rec.events.some((e) => e.type === "engine.signal" && e.engine === "sovereign" && /Redacted/.test(e.text))).toBe(true);
  });

  it("scrubs rounded spellings but never the offer being made", () => {
    const v = sealVault("x", SELLER, BUYER, { initiator: "a", counterparty: "b" });
    const figures = privateFigures(v, "initiator");
    expect(scrubLeaks("we can't go below $41k", figures).text).toBe("we can't go below [sealed]");
    expect(scrubLeaks("our offer is $41,820", figures, [41_820]).text).toBe("our offer is $41,820");
    expect(scrubLeaks("margin floor 27.5%", figures).text).toBe("margin floor [sealed]");
  });

  it("never lets an offer land exactly on a private limit", async () => {
    const rec = await runEnclave(enclave(LOWBALL_BUYER), { apex: deterministicApex });
    const prices = rec.rounds.map((r) => r.terms.priceUsd);
    for (const secret of [SELLER.floorPriceUsd, SELLER.costBasisUsd, LOWBALL_BUYER.ceilingPriceUsd, LOWBALL_BUYER.maxBudgetUsd]) expect(prices).not.toContain(secret);
  });
});
