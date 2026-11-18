import { afterEach, describe, expect, it } from "vitest";
import { GET as card } from "../src/http/agent-card";
import { GET as node } from "../src/http/node";
import { DEV_SIGNING_SECRET, signAccessKey } from "../src/licensing/codec";
import { ROLE_DEFAULTS, ROLE_TIER } from "../src/licensing/types";
import { exchangeKeys, sha256Hex } from "../src/crypto";
import { deriveExchangeKeys } from "../src/key-derivation";
import { verifyAuditChain, type NodeStatus } from "../src/node-status";
import { pushAudit } from "../src/store";

async function operatorKey() {
  const base = ROLE_DEFAULTS.operator;
  return signAccessKey({ keyId: "op_test", holderName: "Test Operator", role: "operator", tier: ROLE_TIER.operator, unlockedEngines: base.unlockedEngines, themeConfig: base.theme, permissions: base.permissions, issuedAt: new Date().toISOString(), expiresAt: null }, DEV_SIGNING_SECRET);
}
const status = async (headers: Record<string, string> = {}) => (await (await node(new Request("http://localhost:3000/api/exchange/node", { headers: { "x-forwarded-for": "10.99.0.1", ...headers } }))).json()) as NodeStatus;

afterEach(() => {
  delete process.env.BLOOM_EXCHANGE_SECRET;
  delete process.env.BLOOM_SOVEREIGN_NODE;
});

describe("sovereign private node", () => {
  it("derives the same root key in the initializer and on the server", async () => {
    const secret = "a".repeat(64);
    process.env.BLOOM_EXCHANGE_SECRET = secret;
    const derived = deriveExchangeKeys(secret);
    expect(exchangeKeys().jwk.kid).toBe(derived.kid);
    expect(derived.fingerprint).toMatch(/^([0-9A-F]{4}:){15}[0-9A-F]{4}$/);
    const published = (await (await card(new Request("http://localhost:3000/.well-known/agent-card.json"))).json()) as { capabilities: { extensions: { params?: { jwks?: { keys: { kid: string; x: string }[] } } }[] } };
    expect(published.capabilities.extensions[0].params!.jwks!.keys[0]).toMatchObject({ kid: derived.kid, x: derived.publicX });
  });

  it("tells anyone the mode and fingerprint, but hides hardware and audit without an operator key", async () => {
    const s = await status();
    expect(s.mode).toBe("cloud");
    expect(s.root.fingerprint).toMatch(/^[0-9A-F:]+$/);
    expect(s).toMatchObject({ operator: false, hardware: null, audit: null });
    process.env.BLOOM_SOVEREIGN_NODE = "1";
    expect((await status()).mode).toBe("sovereign");
  });

  it("reports the air-gap posture from real configuration", async () => {
    const s = await status();
    expect(s.posture).toMatchObject({ modelEgress: false, webhookEgress: false, persistence: "memory", airGapped: true });
  });

  it("shows the operator host hardware and a re-verified audit chain", async () => {
    for (let i = 0; i < 3; i++) await pushAudit({ at: new Date().toISOString(), taskId: `xch_test${i}`, peer: "probe", verdict: "quarantined", vectors: { instruction_override: 1 } }, sha256Hex);
    const s = await status({ "x-bloom-license": await operatorKey() });
    expect(s.operator).toBe(true);
    expect(s.hardware?.cpus).toBeGreaterThan(0);
    expect(s.hardware?.memTotalGb).toBeGreaterThan(0);
    expect(s.audit?.entries.length).toBeGreaterThanOrEqual(3);
    expect(s.audit?.chain).toMatchObject({ intact: true, brokenAt: null });

    const tampered = s.audit!.entries.map((e, i) => (i === 1 ? { ...e, verdict: "clean" } : e));
    expect(verifyAuditChain(tampered)).toMatchObject({ intact: false, checked: 2 });
    const reordered = [s.audit!.entries[1], s.audit!.entries[0], ...s.audit!.entries.slice(2)];
    expect(verifyAuditChain(reordered).intact).toBe(false);
  });
});
