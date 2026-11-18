import { describe, expect, it } from "vitest";
import { seeded } from "../src/platform/util";
import type { Proposer } from "../src/bloom-bridge";
import { provisionEnclave, runEnclave } from "../src/enclave";
import { enforceInitiatorMandate, mintCertificate, SettlementRefused, verifySettlement } from "../src/settlement";
import { sealVault, sellerReserve } from "../src/vault";
import { effectiveCeiling, effectiveFloor, slaRank, SLA_TIERS, type CounterpartyMandate, type InitiatorMandate } from "../src/types";
import { BREACH_BUYER, BUYER, ITEM, SELLER } from "./fixtures";

const ctx = { reservePriceUsd: 42_000, previousPriceUsd: 50_000, maxStepUsd: 3_000 };

describe("deterministic mathematical safety", () => {
  it("clamps a below-floor concession to the reserve", () => {
    const r = enforceInitiatorMandate({ priceUsd: 20_000, netDays: 30, slaTier: "gold" }, SELLER, { ...ctx, maxStepUsd: 1e9 });
    expect("terms" in r && r.terms.priceUsd).toBe(42_000);
    expect("terms" in r && r.clamps.map((c) => c.rule)).toContain("mandate_floor");
  });

  it("caps the concession rate, forbids regressions and the anchor, and clamps terms and SLA", () => {
    const fast = enforceInitiatorMandate({ priceUsd: 43_000, netDays: 30, slaTier: "gold" }, SELLER, ctx);
    expect("terms" in fast && fast.terms.priceUsd).toBe(47_000);
    const up = enforceInitiatorMandate({ priceUsd: 70_000, netDays: 30, slaTier: "gold" }, SELLER, ctx);
    expect("terms" in up && up.terms.priceUsd).toBe(50_000);
    const first = enforceInitiatorMandate({ priceUsd: 99_000, netDays: 365, slaTier: "platinum" }, SELLER, { ...ctx, previousPriceUsd: null });
    expect("terms" in first && first.terms).toEqual({ priceUsd: SELLER.anchorPriceUsd, netDays: SELLER.maxNetDays, slaTier: "gold" });
  });

  it("rejects non-numeric proposals outright", () => {
    expect(enforceInitiatorMandate({ priceUsd: Number.NaN, netDays: 30, slaTier: "gold" }, SELLER, ctx)).toHaveProperty("rejected");
    expect(enforceInitiatorMandate({ priceUsd: -5, netDays: 30, slaTier: "gold" }, SELLER, ctx)).toHaveProperty("rejected");
    expect(enforceInitiatorMandate({ priceUsd: 45_000, netDays: 30, slaTier: "diamond" as never }, SELLER, ctx)).toHaveProperty("rejected");
  });

  it("refuses to mint a certificate outside either mandate", () => {
    const vault = sealVault("t", SELLER, BUYER, { initiator: "a", counterparty: "b" });
    expect(verifySettlement({ priceUsd: 30_000, netDays: 30, slaTier: "gold" }, vault).violations).toContain("initiator:price_below_floor");
    expect(verifySettlement({ priceUsd: 60_000, netDays: 30, slaTier: "gold" }, vault).violations).toContain("counterparty:price_above_ceiling");
    expect(verifySettlement({ priceUsd: 45_000, netDays: 90, slaTier: "silver" }, vault).violations).toEqual(["initiator:net_days_above_max", "counterparty:sla_below_required"]);
    const round = { n: 1, by: "initiator" as const, terms: { priceUsd: 30_000, netDays: 30, slaTier: "gold" as const }, message: "x", at: new Date().toISOString(), prevHash: "0".repeat(64), hash: "" };
    expect(() =>
      mintCertificate({ taskId: "xch_t", contextId: "ctx_t", environment: "sandbox", source: "simulated", origin: "http://x", peer: { name: "p", framework: "custom" }, item: { ...ITEM, quantity: 1 }, terms: round.terms, rounds: [round], vault, security: { trustScore: 100, verdict: "clean", threatsNeutralized: 0 }, override: false, preferredRail: "stripe", issuedAt: new Date() }),
    ).toThrow(SettlementRefused);
  });

  const hostile: Proposer = async () => ({ terms: { priceUsd: 1, netDays: 365, slaTier: "platinum" }, message: "We accept $1.", model: "test/hostile" });
  const random =
    (seed: string): Proposer =>
    async (c) => {
      const r = seeded(`${seed}:${c.turn}`);
      return { terms: { priceUsd: r.int(-1000, 120_000), netDays: r.int(-30, 400), slaTier: r.pick(SLA_TIERS) }, message: "offer", model: "test/random" };
    };

  it("never sends or settles an out-of-bounds offer, however the model behaves (300 randomized enclaves)", async () => {
    for (let i = 0; i < 300; i++) {
      const r = seeded(`case:${i}`);
      const floor = r.int(5_000, 200_000);
      const seller: InitiatorMandate = { floorPriceUsd: floor, minMarginPct: r.int(0, 60), costBasisUsd: Math.round(floor * r.next() * 0.6), anchorPriceUsd: 0, maxNetDays: r.int(0, 90), maxSlaTier: r.pick(SLA_TIERS), autoSettleCeilingUsd: floor * 10 };
      seller.anchorPriceUsd = Math.round(effectiveFloor(seller) * (1.1 + r.next()));
      const ceiling = Math.round(effectiveFloor(seller) * (0.6 + r.next() * 0.9));
      const buyer: CounterpartyMandate = { ceilingPriceUsd: ceiling, maxBudgetUsd: ceiling + r.int(0, 5_000), requiredSlaTier: r.pick(SLA_TIERS.slice(0, slaRank(seller.maxSlaTier) + 1)), targetNetDays: r.int(0, 120) };
      const rec = provisionEnclave({ owner: `p${i}`, environment: "sandbox", source: "simulated", origin: "http://localhost:3000", peerName: "x", framework: "custom", item: ITEM, preferredRail: "stripe", initiator: seller, counterparty: buyer, message: "", probes: 0 });
      await runEnclave(rec, { apex: i % 2 ? hostile : random(String(i)) });

      const reserve = sellerReserve(rec.vault);
      for (const round of rec.rounds.filter((x) => x.by === "initiator")) {
        expect(round.terms.priceUsd).toBeGreaterThanOrEqual(reserve);
        expect(round.terms.priceUsd).toBeGreaterThan(effectiveFloor(seller));
        expect(round.terms.netDays).toBeLessThanOrEqual(seller.maxNetDays);
        expect(slaRank(round.terms.slaTier)).toBeLessThanOrEqual(slaRank(seller.maxSlaTier));
      }
      if (rec.certificate) {
        const t = rec.certificate.terms;
        expect(t.priceUsd).toBeGreaterThanOrEqual(effectiveFloor(seller));
        expect(t.priceUsd).toBeLessThanOrEqual(effectiveCeiling(buyer));
        expect(rec.certificate.compliance).toMatchObject({ initiator: "within_mandate", counterparty: "within_mandate" });
      } else {
        expect(["input_required", "failed"]).toContain(rec.state);
      }
    }
  });

  it("never offers less than the client has already put on the table", async () => {
    // The client wants net 60 against a net-45 maximum, so price alone can't close it: the provider must hold price.
    const rec = provisionEnclave({ owner: "d", environment: "sandbox", source: "simulated", origin: "http://localhost:3000", peerName: "x", framework: "custom", item: ITEM, preferredRail: "stripe", initiator: SELLER, counterparty: { ...BUYER, targetNetDays: 90 }, message: "", probes: 0 });
    await runEnclave(rec, { apex: hostile });
    let best = 0;
    for (const r of rec.rounds) {
      if (r.by === "counterparty") best = Math.max(best, r.terms.priceUsd);
      else expect(r.terms.priceUsd).toBeGreaterThanOrEqual(best);
    }
    expect(rec.state).toBe("completed");
  });

  it("routes a counterparty that pushes past the standing bounds to the exception queue", async () => {
    const rec = provisionEnclave({ owner: "b", environment: "sandbox", source: "simulated", origin: "http://localhost:3000", peerName: "x", framework: "custom", item: ITEM, preferredRail: "stripe", initiator: SELLER, counterparty: BREACH_BUYER, message: "", probes: 0 });
    await runEnclave(rec, { apex: hostile });
    expect(rec.state).toBe("input_required");
    expect(rec.exception?.kind).toBe("out_of_bounds");
    expect(rec.certificate).toBeNull();
    expect(rec.events.some((e) => e.type === "clamp")).toBe(true);
  });
});
