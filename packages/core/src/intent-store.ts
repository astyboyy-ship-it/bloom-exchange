import { randomId, sha256Hex } from "./crypto";
import { provisionEnclave } from "./enclave";
import { QUARANTINED, scanText, screenPayload } from "./firewall";
import { execute, type Caller } from "./gateway";
import { normalize, type AgentIntentNode, type IntentStage, type ResourceVector } from "./omni-adapter";
import { getStandingMandate, listIntents, listPulse, pushIntent, pushPulse, saveTask } from "./store";
import { commitment } from "./vault";
import { DEFAULT_STANDING_MANDATE, type CounterpartyMandate, type PeerFramework, type ResourceDimension } from "./types";

/**
 * The intent pipeline: any protocol's payload → AgentIntentNode → Shield → double-blind vault → Sovereign → clearing.
 * Every stage is the real one (the same firewall, vault, allocator, negotiation and signer as the A2A gateway); the
 * trace records when each happened, so the terminal can replay it at human speed next to the measured latency.
 * Intents are demonstrations of the clearing path, so they always run non-binding: a sandbox enclave, or a stress
 * test against the standing mandate for the operator.
 */

const FRAMEWORK: Record<string, PeerFramework> = { a2a: "bloom-sdk", mcp: "anthropic", langgraph: "langgraph", autogen: "custom", crewai: "custom" };
const marketEstimate = (v: ResourceVector) => Math.round(46_000 + 0.3 * v.computeUnits + 0.12 * v.energyKwh + 130 * v.bandwidthGbps + 320 * v.complianceToken);

/** The client side of the enclave, derived only from what the intent itself asked for (never from the provider). */
export function intentMandate(v: ResourceVector): CounterpartyMandate {
  const ceiling = Math.round(v.capitalUsd > 0 ? v.capitalUsd : marketEstimate(v));
  const resources: CounterpartyMandate["resources"] = {};
  for (const d of ["computeUnits", "energyKwh", "complianceToken", "bandwidthGbps"] as ResourceDimension[]) {
    const q = v[d];
    if (q > 0) resources[d] = { quantity: q, minQuantity: Math.max(Math.min(q, 1), Math.round(q * 0.25 * 100) / 100) };
  }
  return {
    ceilingPriceUsd: ceiling,
    maxBudgetUsd: Math.round(ceiling * 1.05),
    requiredSlaTier: "gold",
    targetNetDays: 30,
    openingPriceUsd: Math.round(ceiling * 0.72),
    ...(Object.keys(resources).length && { resources }),
  };
}

export async function processIntent(caller: Caller, input: { protocol: string; payload?: unknown; source?: string; goal?: string }): Promise<AgentIntentNode> {
  const t0 = performance.now();
  const stamp = () => new Date().toISOString();
  const n = normalize(input);
  const node: AgentIntentNode = {
    id: randomId("int_", 12),
    domain: n.domain,
    protocol: n.protocol,
    protocolLabel: n.protocolLabel,
    agentName: n.agentName,
    coreGoal: n.coreGoal,
    resourceVector: n.resourceVector,
    progress: 10,
    invariantStatus: "locked",
    stage: "received",
    shield: { verdict: "clean", threats: 0, vectors: [] },
    clamp: [],
    taskId: null,
    certificateId: null,
    priceUsd: null,
    environment: caller.operator ? "stress-test" : "sandbox",
    latencyMs: null,
    receivedAt: stamp(),
    trace: [],
  };
  const step = (stage: IntentStage, progress: number, detail: string) => {
    node.stage = stage;
    node.progress = progress;
    node.trace.push({ stage, at: stamp(), detail });
  };
  step("received", 10, `${n.protocolLabel} payload received`);
  step("normalized", 30, `Normalized into AgentIntentNode · ${n.domain}`);

  // Shield screens every string the sender controls; the goal and agent name are rewritten if anything was found.
  const scan = screenPayload({ message: n.scanText });
  const strip = (s: string) => s.replace(/\[neutralized:[a-z_]+\]/g, "").replace(/\s+/g, " ").trim();
  node.shield = { verdict: scan.verdict, threats: scan.threats.length, vectors: [...new Set(scan.threats.map((t) => t.vector))] };
  node.agentName = strip(scanText(n.agentName, "agent").clean) || `${n.protocolLabel} agent`;
  node.coreGoal = scan.verdict === "quarantined" ? QUARANTINED : scanText(n.coreGoal, "goal").clean;
  step("shielded", 50, scan.threats.length ? `Shield ${scan.verdict}: ${scan.threats.length} vector${scan.threats.length === 1 ? "" : "s"}` : "Shield clean");

  const finish = async () => {
    node.latencyMs = Math.round((performance.now() - t0) * 10) / 10;
    await pushIntent(caller.owner, node);
    await pushPulse({ at: node.receivedAt, domain: node.domain, protocol: node.protocol === "custom" ? `custom:${sha256Hex(node.protocolLabel).slice(0, 8)}` : node.protocol, agent: sha256Hex(`${caller.owner}|${node.agentName}`).slice(0, 12), vector: node.resourceVector, latencyMs: node.latencyMs, status: node.invariantStatus });
    return node;
  };

  if (scan.verdict === "quarantined") {
    node.invariantStatus = "quarantined";
    node.progress = 100;
    node.trace.push({ stage: "quarantined", at: stamp(), detail: "Quarantined: hostile payload never reached the vault" });
    return finish();
  }

  const initiator = caller.operator ? (await getStandingMandate()).mandate : DEFAULT_STANDING_MANDATE;
  const goalText = strip(node.coreGoal);
  const rec = provisionEnclave({
    owner: caller.owner,
    environment: node.environment,
    source: caller.decision.serverKey || caller.own.anthropic || caller.own.openrouter ? "live" : "simulated",
    origin: caller.origin,
    peerName: node.agentName,
    framework: FRAMEWORK[node.protocol] ?? "custom",
    item: { description: `${n.protocolLabel}: ${goalText}`.slice(0, 200), quantity: 1 },
    preferredRail: node.domain === "FINANCIAL_RAILS" ? "x402" : "stripe",
    initiator,
    counterparty: intentMandate(node.resourceVector),
    message: goalText,
    probes: 0,
  });
  node.taskId = rec.id;
  const alloc = rec.allocation;
  node.clamp = alloc ? (Object.keys(intentMandate(node.resourceVector).resources ?? {}) as ResourceDimension[]).map((d) => ({ dimension: d, requested: node.resourceVector[d], granted: alloc.allocation[d] ?? 0 })) : [];
  step("vaulted", 70, `Sealed in double-blind vault · client commitment ${commitment(sha256Hex, rec.vault.counterparty, rec.vault.salts.counterparty).slice(0, 12)}…`);
  await saveTask(rec);

  const done = await execute(caller, { kind: "new", rec });
  node.priceUsd = done.certificate?.terms.priceUsd ?? null;
  node.certificateId = done.certificate?.certificateId ?? null;
  if (done.state === "completed" && done.certificate) {
    node.invariantStatus = "settled";
    step("cleared", 100, `Sovereign verified both mandates · ${done.rounds.length} rounds`);
    node.trace.push({ stage: "settled", at: stamp(), detail: done.certificate.certificateId });
  } else {
    node.invariantStatus = "clamped";
    step("cleared", 100, done.exception ? `Held at mandate bound: ${done.exception.kind.replace(/_/g, " ")}` : (done.statusReason ?? "Held by Sovereign"));
    node.trace.push({ stage: "held", at: stamp(), detail: done.statusReason ?? "Awaiting a revised mandate or executive decision" });
  }
  return finish();
}

export const ownIntents = (caller: Caller) => listIntents<AgentIntentNode>(caller.owner);
export { listPulse };
