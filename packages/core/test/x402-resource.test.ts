import { describe, expect, it } from "vitest";
import { handle } from "../src/http/router";
import { DEV_SIGNING_SECRET, signAccessKey } from "../src/licensing/codec";
import { ROLE_DEFAULTS, ROLE_TIER } from "../src/licensing/types";
import type { SettlementCertificate } from "../src/types";
import { BUYER, ITEM, SELLER } from "./fixtures";

/**
 * Audit #2: the signed certificate's x402 `resource` must be a URL its payer can actually fetch. 0.1.0 named the
 * provider's operator view (/api/exchange/tasks/{id}), which answers 404 to a production payer.
 */
const BASE = "http://localhost:3000";

async function key(keyId: string) {
  const b = ROLE_DEFAULTS.enterprise;
  return signAccessKey({ keyId, holderName: keyId, role: "enterprise", tier: ROLE_TIER.enterprise, unlockedEngines: b.unlockedEngines, themeConfig: b.theme, permissions: b.permissions, issuedAt: new Date().toISOString(), expiresAt: null }, DEV_SIGNING_SECRET);
}

let ip = 0;
async function settle(opts: { key?: string; sandbox?: boolean }): Promise<SettlementCertificate> {
  const bloomExchange = { intent: "negotiate", mandate: BUYER, item: ITEM, ...(opts.sandbox && { sandbox: { initiatorMandate: SELLER } }) };
  const res = await handle(
    new Request(`${BASE}/api/exchange/a2a`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": `10.55.0.${++ip}`, ...(opts.key && { "x-bloom-license": opts.key }) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "SendMessage", params: { message: { messageId: crypto.randomUUID(), role: "user", parts: [{ kind: "data", data: { bloomExchange } }] } } }),
    }),
  );
  const task = ((await res.json()) as { result: { status: { state: string }; artifacts: { parts: { data: SettlementCertificate }[] }[] } }).result;
  expect(task.status.state).toBe("completed");
  return task.artifacts[0].parts[0].data;
}

const get = async (url: string, licenseKey?: string) => handle(new Request(url, { headers: { "x-forwarded-for": "10.55.9.9", ...(licenseKey && { "x-bloom-license": licenseKey }) } }));

describe("x402 resource in the signed certificate", () => {
  it("names the task's public A2A resource, which the production payer can fetch", async () => {
    const payer = await key("ent_payer");
    const cert = await settle({ key: payer });
    expect(cert.environment).toBe("production");
    expect(cert.settlement.binding).toBe(true);
    expect(cert.settlement.x402.resource).toBe(`${BASE}/api/exchange/a2a/v1/tasks/${cert.taskId}`);

    const res = await get(cert.settlement.x402.resource, payer);
    expect(res.status).toBe(200);
    const task = (await res.json()) as { id: string; artifacts: { parts: { data: { certificateId: string } }[] }[] };
    expect(task.id).toBe(cert.taskId);
    expect(task.artifacts[0].parts[0].data.certificateId).toBe(cert.certificateId);

    // The 0.1.0 target was the operator view: the same payer got 404 there.
    expect((await get(`${BASE}/api/exchange/tasks/${cert.taskId}`, payer)).status).toBe(404);
  });

  it("keeps the resource as private as the task: a stranger still gets 404 for a production task", async () => {
    const cert = await settle({ key: await key("ent_payer_two") });
    expect((await get(cert.settlement.x402.resource, await key("ent_stranger"))).status).toBe(404);
    expect((await get(cert.settlement.x402.resource)).status).toBe(404);
  });

  it("resolves for anyone on a sandbox task, as GetTask does", async () => {
    const cert = await settle({ sandbox: true });
    expect(cert.settlement.binding).toBe(false);
    expect(cert.settlement.x402.resource).toBe(`${BASE}/api/exchange/a2a/v1/tasks/${cert.taskId}`);
    expect((await get(cert.settlement.x402.resource)).status).toBe(200);
  });
});
