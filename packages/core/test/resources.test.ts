import { describe, expect, it } from "vitest";
import { cardKeys, verifyCertificate, type AgentCard, type SettlementCertificate } from "@bloom-exchange/sdk";
import { GET as cardRoute } from "../src/http/agent-card";
import { deterministicApex } from "../src/bloom-bridge";
import { provisionEnclave, runEnclave } from "../src/enclave";
import { allocate, resourceFloorUsd } from "../src/resources";
import { verifySettlement } from "../src/settlement";
import { initiatorFloor, sealVault } from "../src/vault";
import type { CounterpartyMandate, InitiatorMandate } from "../src/types";
import { ITEM, rpc, SELLER, sendParams } from "./fixtures";

/** A provider whose resource floors ($47,540 at full capacity) can dominate its $41k price floor. */
const GRID: InitiatorMandate = {
  ...SELLER,
  anchorPriceUsd: 88_911,
  resources: {
    computeUnits: { capacity: 100_000, floorUnitPriceUsd: 0.37 },
    energyKwh: { capacity: 50_000, floorUnitPriceUsd: 0.13 },
    bandwidthGbps: { capacity: 40, floorUnitPriceUsd: 101 },
  },
};
const BUYER: CounterpartyMandate = {
  ceilingPriceUsd: 79_731,
  maxBudgetUsd: 82_113,
  requiredSlaTier: "gold",
  targetNetDays: 30,
  resources: { computeUnits: { quantity: 130_000, minQuantity: 80_000 }, energyKwh: { quantity: 30_000 }, bandwidthGbps: { quantity: 25 } },
};

const enclave = (seller: InitiatorMandate, buyer: CounterpartyMandate) =>
  provisionEnclave({ owner: "r", environment: "sandbox", source: "simulated", origin: "http://localhost:3000", peerName: "swarm", framework: "custom", item: ITEM, preferredRail: "x402", initiator: seller, counterparty: buyer, message: "", probes: 0 });

describe("universal resource clearing", () => {
  it("allocates deterministically: clamps to capacity, honours minimums, rejects what isn't offered", () => {
    const r = allocate(GRID.resources, BUYER.resources)!;
    expect(r.allocation).toEqual({ computeUnits: 100_000, energyKwh: 30_000, bandwidthGbps: 25 });
    expect(r.clamped).toEqual(["computeUnits"]);
    expect(r.shortfalls).toEqual([]);
    const breach = allocate(GRID.resources, { computeUnits: { quantity: 150_000, minQuantity: 120_000 }, capitalUsd: { quantity: 1_000_000 } })!;
    expect(breach.shortfalls.map((s) => s.dimension)).toEqual(["computeUnits", "capitalUsd"]);
    expect(allocate(GRID.resources, undefined)).toBeNull();
  });

  it("raises the provider's floor to the allocated resources' floor", () => {
    const alloc = allocate(GRID.resources, BUYER.resources)!.allocation;
    const v = sealVault("t", GRID, BUYER, { initiator: "a", counterparty: "b" }, alloc);
    expect(resourceFloorUsd(GRID.resources, alloc)).toBe(100_000 * 0.37 + 30_000 * 0.13 + 25 * 101);
    expect(initiatorFloor(v)).toBeCloseTo(43_425, 2);
  });

  it("settles price and resources together, with per-dimension proofs that verify offline", async () => {
    const rec = await runEnclave(enclave(GRID, BUYER), { apex: deterministicApex });
    expect(rec.state).toBe("completed");
    const cert = rec.certificate!;
    expect(cert.resources?.allocation).toEqual({ computeUnits: 100_000, energyKwh: 30_000, bandwidthGbps: 25 });
    expect(cert.resources?.proofs.find((p) => p.dimension === "computeUnits")).toMatchObject({ requested: 130_000, granted: 100_000, compliance: "clamped_to_capacity" });
    expect(cert.terms.priceUsd).toBeGreaterThanOrEqual(resourceFloorUsd(GRID.resources, cert.resources!.allocation));
    expect(rec.signals.some((s) => s.kind === "hoarding")).toBe(false);
    const card = (await cardRoute(new Request("http://localhost:3000/.well-known/agent-card.json")).json()) as AgentCard;
    expect((await verifyCertificate(cert as unknown as SettlementCertificate, cardKeys(card))).valid).toBe(true);
  });

  it("flags hoarding when a swarm requests far beyond capacity", async () => {
    const rec = await runEnclave(enclave(GRID, { ...BUYER, resources: { computeUnits: { quantity: 900_000, minQuantity: 50_000 } } }), { apex: deterministicApex });
    expect(rec.signals.some((s) => s.kind === "hoarding")).toBe(true);
    expect(rec.vault.allocation).toEqual({ computeUnits: 100_000 });
  });

  it("sends a capacity breach to the exception queue and can't be overridden into a settlement", async () => {
    const rec = await runEnclave(enclave(GRID, { ...BUYER, resources: { computeUnits: { quantity: 400_000, minQuantity: 300_000 } } }), { apex: deterministicApex });
    expect(rec.state).toBe("input_required");
    expect(rec.exception).toMatchObject({ kind: "resource_bounds", counterTerms: null });
    const v = sealVault("t", GRID, BUYER, { initiator: "a", counterparty: "b" }, { computeUnits: 200_000 });
    const check = verifySettlement({ priceUsd: 80_000, netDays: 30, slaTier: "gold" }, v, true);
    expect(check.initiator).toBe("violation");
  });

  it("never discloses a unit floor or capacity limit to the external agent", async () => {
    const { text, json } = await rpc("SendMessage", sendParams({ seller: GRID, buyer: BUYER }));
    expect(json.result?.status).toMatchObject({ state: "completed" });
    expect((json.result?.metadata as Record<string, unknown>)["bloom.allocation"]).toEqual({ computeUnits: 100_000, energyKwh: 30_000, bandwidthGbps: 25 });
    expect(text).not.toMatch(/floorUnitPriceUsd|"capacity"|0\.37|0\.13|"101"/);
  });
});
