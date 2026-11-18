import { describe, expect, it } from "vitest";
import { verifyAgentCard, verifyCertificate, cardKeys, type AgentCard, type SettlementCertificate } from "@bloom-exchange/sdk";
import { GET as cardRoute } from "../src/http/agent-card";
import { POST as a2a } from "../src/http/a2a";
import { POST as rest } from "../src/http/a2a-rest";
import { POST as decide } from "../src/http/decision";
import { BREACH_BUYER, BUYER, rpc, rpcRequest, SELLER, sendParams, sseFrames } from "./fixtures";
import { effectiveCeiling, effectiveFloor } from "../src/types";

async function card(): Promise<AgentCard> {
  return (await cardRoute(new Request("http://localhost:3000/.well-known/agent-card.json")).json()) as AgentCard;
}
const certOf = (task: Record<string, unknown>) => ((task.artifacts as { parts: { data: unknown }[] }[])[0]?.parts[0]?.data ?? null) as SettlementCertificate | null;

describe("end-to-end autonomous settlement", () => {
  it("publishes a signed A2A v1.0 agent card", async () => {
    const c = await card();
    expect(c.supportedInterfaces.map((i) => i.protocolBinding)).toEqual(["JSONRPC", "HTTP+JSON"]);
    expect(c.capabilities.streaming).toBe(true);
    expect(c.skills.map((s) => s.id)).toEqual(["autonomous-negotiation", "scope-arbitration", "mandate-settlement"]);
    expect(await verifyAgentCard(c)).toMatchObject({ valid: true });
    expect(await verifyAgentCard({ ...c, description: "tampered" })).toMatchObject({ valid: false });
  });

  it("settles a JSON-RPC SendMessage autonomously and mints a verifiable BLOOM-XCH + AP2 certificate", async () => {
    const { json } = await rpc("SendMessage", sendParams());
    const task = json.result!;
    expect(task.status).toMatchObject({ state: "completed" });
    expect((task.history as unknown[]).length).toBeGreaterThanOrEqual(3);
    const cert = certOf(task)!;
    expect(cert.certificateId).toMatch(/^BLOOM-XCH-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(cert.terms.priceUsd).toBeGreaterThanOrEqual(effectiveFloor(SELLER));
    expect(cert.terms.priceUsd).toBeLessThanOrEqual(effectiveCeiling(BUYER));

    const keys = cardKeys(await card());
    const ok = await verifyCertificate(cert, keys);
    expect(ok).toEqual({ valid: true, checks: { digest: true, certificateId: true, chain: true, signature: true, ap2Proofs: true } });

    expect(cert.ap2.checkoutMandate.type).toContain("AP2CheckoutMandate");
    expect(cert.ap2.paymentMandate.type).toContain("AP2PaymentMandate");
    expect(cert.settlement.stripe).toMatchObject({ paymentIntent: { amount: cert.terms.priceUsd * 100, currency: "usd" }, idempotencyKey: cert.certificateId });
    expect(cert.settlement.x402).toMatchObject({ x402Version: 1, scheme: "exact", network: "base-sepolia", maxAmountRequired: String(cert.terms.priceUsd * 1_000_000) });
    expect(cert.settlement.binding).toBe(false);

    const tampered = { ...cert, terms: { ...cert.terms, priceUsd: cert.terms.priceUsd - 5_000 } };
    expect((await verifyCertificate(tampered, keys)).valid).toBe(false);
    const rewritten = { ...cert, rounds: { ...cert.rounds, chain: cert.rounds.chain.map((r, i) => (i === 0 ? { ...r, message: "rewritten" } : r)) } };
    expect((await verifyCertificate(rewritten, keys)).checks.chain).toBe(false);
  });

  it("streams the lifecycle over SSE: task, rounds, settlement artifact, final status", async () => {
    const res = await a2a(rpcRequest({ jsonrpc: "2.0", id: 7, method: "SendStreamingMessage", params: sendParams() }));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const results = (await sseFrames(res)).frames.map((f) => f.result as Record<string, unknown>);
    expect(results[0].kind).toBe("task");
    const states = results.filter((r) => r.kind === "status-update").map((r) => (r.status as { state: string }).state);
    expect(states).toContain("working");
    expect(results.filter((r) => (r.metadata as Record<string, { type?: string }>)?.["bloom.event"]?.type === "round").length).toBeGreaterThanOrEqual(3);
    expect(results.some((r) => r.kind === "artifact-update")).toBe(true);
    expect(results.at(-1)).toMatchObject({ kind: "status-update", final: true, status: { state: "completed" } });
  });

  it("answers the same Idempotency-Key with the same task, and never settles twice", async () => {
    const params = sendParams();
    const headers = { "Idempotency-Key": `idem-${crypto.randomUUID()}`, "x-forwarded-for": "10.200.0.1" };
    const first = await a2a(new Request("http://localhost:3000/api/exchange/a2a", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "SendMessage", params }) }));
    const second = await a2a(new Request("http://localhost:3000/api/exchange/a2a", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "SendMessage", params }) }));
    const a = (await first.json()) as { result: Record<string, unknown> };
    const b = (await second.json()) as { result: Record<string, unknown> };
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect(b.result.id).toBe(a.result.id);
    expect(certOf(b.result)?.certificateId).toBe(certOf(a.result)?.certificateId);

    const conflict = await a2a(new Request("http://localhost:3000/api/exchange/a2a", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "SendMessage", params: sendParams() }) }));
    expect(((await conflict.json()) as { error: { code: number } }).error.code).toBe(-32050);
  });

  it("escalates an out-of-bounds counter, then settles on executive override with the override on the certificate", async () => {
    const { json } = await rpc("SendMessage", sendParams({ buyer: BREACH_BUYER }));
    const task = json.result!;
    expect(task.status).toMatchObject({ state: "input_required" });
    expect((task.metadata as Record<string, unknown>)["bloom.awaiting"]).toBe("revised_mandate_or_executive");
    expect(JSON.stringify(task)).not.toMatch(/below the effective floor/);

    const res = await decide(new Request(`http://localhost:3000/api/exchange/tasks/${task.id}/decision`, { method: "POST", body: JSON.stringify({ action: "override" }) }), { params: Promise.resolve({ id: task.id }) });
    const view = (await res.json()) as { state: string; certificate: SettlementCertificate & { compliance: { initiator: string } } };
    expect(view.state).toBe("completed");
    expect(view.certificate.compliance.initiator).toBe("executive_override");
    expect((await verifyCertificate(view.certificate, cardKeys(await card()))).valid).toBe(true);
  });

  it("resumes an escalated task on a revised mandate, continuing the same hash chain", async () => {
    const { json } = await rpc("SendMessage", sendParams({ buyer: BREACH_BUYER }));
    const id = json.result!.id;
    const resumed = await rpc("SendMessage", { message: { messageId: crypto.randomUUID(), role: "user", taskId: id, parts: [{ kind: "data", data: { bloomExchange: { mandate: BUYER } } }] } });
    expect(resumed.json.result?.status).toMatchObject({ state: "completed" });
    const cert = certOf(resumed.json.result!)!;
    expect(cert.rounds.chain[0].prevHash).toBe("0".repeat(64));
    expect((await verifyCertificate(cert, cardKeys(await card()))).checks.chain).toBe(true);
  });

  it("serves the same negotiation over the HTTP+JSON binding", async () => {
    const res = await rest(new Request("http://localhost:3000/api/exchange/a2a/v1/message:send", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "10.201.0.1" }, body: JSON.stringify(sendParams()) }), { params: Promise.resolve({ path: ["message:send"] }) });
    const body = (await res.json()) as { task: Record<string, unknown> };
    expect(body.task.status).toMatchObject({ state: "completed" });
  });

  it("rejects malformed JSON-RPC and unknown methods with spec error codes", async () => {
    const parse = await a2a(new Request("http://localhost:3000/api/exchange/a2a", { method: "POST", headers: { "x-forwarded-for": "10.202.0.1" }, body: "{not json" }));
    expect(((await parse.json()) as { error: { code: number } }).error.code).toBe(-32700);
    expect((await rpc("tasks/unknown", {})).json.error?.code).toBe(-32601);
    expect((await rpc("SendMessage", { message: { parts: [{ kind: "text", text: "hi" }] } })).json.error?.code).toBe(-32602);
    expect((await rpc("GetTask", { id: "xch_doesnotexist000000" })).json.error?.code).toBe(-32001);
  });
});
