import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { inProcessFetch } from "@bloom-exchange/core/http/router";
import { BloomExchangeClient } from "../src/client.ts";
import { run } from "../src/cli.ts";
import type { SettlementCertificate } from "../src/types.ts";

/** A real negotiation, in-process, through the node's handlers: the certificate is minted by the engine itself. */
const BASE = "http://localhost:3000";
let dir: string;
let cert: SettlementCertificate;
let card: unknown;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "bloom-verify-"));
  const client = new BloomExchangeClient({ baseUrl: BASE, fetch: inProcessFetch, agent: { name: "cli-test-buyer", framework: "custom" } });
  const { certificate } = await client.negotiate({ mandate: { ceilingPriceUsd: 52_500, maxBudgetUsd: 55_000, requiredSlaTier: "gold", targetNetDays: 60 }, item: { description: "Managed observability platform, 12-month enterprise license", quantity: 1 } }).result;
  expect(certificate).not.toBeNull();
  cert = certificate!;
  card = await (await inProcessFetch(`${BASE}/.well-known/agent-card.json`)).json();
  writeFileSync(join(dir, "receipt.json"), JSON.stringify(cert));
  writeFileSync(join(dir, "export.json"), JSON.stringify({ taskId: "x", certificate: cert }));
  writeFileSync(join(dir, "card.json"), JSON.stringify(card));
});

describe("bloom-verify", () => {
  it("verifies a genuine receipt offline against a saved Agent Card (exit 0)", async () => {
    const r = await run([join(dir, "receipt.json"), "--card", join(dir, "card.json")]);
    expect(r.code).toBe(0);
    expect(r.out?.valid).toBe(true);
    expect(r.out?.checks).toEqual({ digest: true, certificateId: true, chain: true, signature: true, ap2Proofs: true, agentCard: true });
  });

  it("fetches the issuer's Agent Card when no --card is given", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = inProcessFetch;
    try {
      const r = await run([join(dir, "receipt.json")]);
      expect(r.code).toBe(0);
      expect(r.out?.keySource).toBe(cert.issuer.agentCard);
    } finally {
      globalThis.fetch = real;
    }
  });

  it("accepts a leading `verify` subcommand (npx @bloom-exchange/sdk verify …)", async () => {
    const r = await run(["verify", join(dir, "receipt.json"), "--card", join(dir, "card.json")]);
    expect(r.code).toBe(0);
    expect(r.out?.valid).toBe(true);
  });

  it("finds the certificate inside an enclave export", async () => {
    expect((await run([join(dir, "export.json"), "--card", join(dir, "card.json")])).code).toBe(0);
  });

  it("rejects a receipt whose settled price was altered (exit 1)", async () => {
    const forged = { ...cert, terms: { ...cert.terms, priceUsd: cert.terms.priceUsd - 1000 } };
    writeFileSync(join(dir, "forged.json"), JSON.stringify(forged));
    const r = await run([join(dir, "forged.json"), "--card", join(dir, "card.json")]);
    expect(r.code).toBe(1);
    expect(r.out?.checks.digest).toBe(false);
  });

  it("rejects keys from a tampered Agent Card even when the receipt is intact", async () => {
    writeFileSync(join(dir, "bad-card.json"), JSON.stringify({ ...(card as object), name: "impostor" }));
    const r = await run([join(dir, "receipt.json"), "--card", join(dir, "bad-card.json")]);
    expect(r.code).toBe(1);
    expect(r.out?.checks.agentCard).toBe(false);
  });

  it("reports usage and unreadable input with exit 2", async () => {
    expect((await run([])).code).toBe(2);
    expect((await run([join(dir, "missing.json")])).code).toBe(2);
    writeFileSync(join(dir, "not-a-receipt.json"), JSON.stringify({ hello: "world" }));
    expect((await run([join(dir, "not-a-receipt.json"), "--card", join(dir, "card.json")])).code).toBe(2);
  });
});
