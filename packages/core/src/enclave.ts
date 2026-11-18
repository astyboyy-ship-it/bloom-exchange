import { randomHex, randomId, sha256Hex } from "./crypto.ts";
import { QUARANTINED, scanAgentCard, screenPayload, verdictFor, type PeerCard } from "./firewall.ts";
import { aetherProof, shieldAssess, slaFeasible, usd, type Posture, type Proposer } from "./bloom-bridge.ts";
import { chainRound, negotiate } from "./negotiation.ts";
import { dispatchSettlement, mintCertificate, SettlementRefused, verifySettlement } from "./settlement.ts";
import { addToLedger, cancelRequested, pushAudit, pushTraffic, recordProbe, requestCancel, saveTask, type TrafficEvent } from "./store.ts";
import { allocate, resourceFloorUsd, type AllocationResult } from "./resources.ts";
import { counterpartyPolicy, initiatorFloor, sealVault, type SealedVault } from "./vault.ts";
import {
  RESOURCE_UNITS,
  TERMINAL,
  type AetherProof,
  type CortexSignal,
  type CounterpartyMandate,
  type Environment,
  type ExceptionKind,
  type ExchangeEvent,
  type ExchangeEventInput,
  type FirewallVerdict,
  type InitiatorMandate,
  type Item,
  type OperatorRoundDetail,
  type PaymentRail,
  type PeerFramework,
  type PublicRound,
  type SettlementCertificate,
  type Source,
  type TaskState,
  type Terms,
  type Threat,
} from "./types.ts";

/**
 * A ClearinghouseEnclave: one isolated negotiation between the provider's standing mandate and one external
 * agent's mandate. Provisioned per incoming task, it screens the payload, scores trust, negotiates, verifies and
 * either mints a settlement certificate or raises an exception for the provider's executive. The record is the
 * single source of truth; projection.ts derives what each audience may see.
 */

export type EnclaveRecord = {
  id: string;
  contextId: string;
  createdAt: string;
  updatedAt: string;
  /** Hashed caller identity; GetTask and CancelTask are scoped to it for licensed callers. */
  owner: string;
  environment: Environment;
  source: Source;
  origin: string;
  peer: { name: string; framework: PeerFramework };
  item: Item;
  preferredRail: PaymentRail;
  vault: SealedVault;
  state: TaskState;
  statusReason: string | null;
  counterpartyMessage: string;
  rounds: PublicRound[];
  operatorRounds: OperatorRoundDetail[];
  security: { trust: number; posture: Posture; verdict: FirewallVerdict; threats: Threat[] };
  signals: CortexSignal[];
  restructures: AetherProof["restructures"];
  /** Sovereign's resource allocation (null when the client requested no resource dimensions). */
  allocation: AllocationResult | null;
  aether: AetherProof | null;
  exception: { kind: ExceptionKind; detail: string; counterTerms: Terms | null } | null;
  agreedTerms: Terms | null;
  certificate: SettlementCertificate | null;
  decision: { action: "override" | "reject"; by: string; at: string } | null;
  dispatch: "dispatched" | "skipped" | "failed" | null;
  usage: { input: number; output: number; liveTurns: number; model: string };
  events: ExchangeEvent[];
};

export type ProvisionInput = {
  owner: string;
  environment: Environment;
  source: Source;
  origin: string;
  peerName: string;
  framework: PeerFramework;
  peerCard?: PeerCard;
  item: Item;
  preferredRail: PaymentRail;
  initiator: InitiatorMandate;
  counterparty: CounterpartyMandate;
  message: string;
  probes: number;
  now?: Date;
  id?: string;
};

export type RunDeps = {
  apex: Proposer;
  /** Called for every event as it happens (the SSE stream). */
  emit?: (e: ExchangeEvent, rec: EnclaveRecord) => void;
  pacingMs?: number;
  maxTurns?: number;
  now?: () => Date;
};

type Hooks = Pick<RunDeps, "emit" | "now">;

const now = (deps?: { now?: () => Date }) => (deps?.now ?? (() => new Date()))();

function event(rec: EnclaveRecord, e: ExchangeEventInput, at: Date, deps?: Hooks) {
  const full = { ...e, at: at.toISOString() } as ExchangeEvent;
  rec.events.push(full);
  rec.updatedAt = full.at;
  deps?.emit?.(full, rec);
  return full;
}

async function traffic(rec: EnclaveRecord, kind: TrafficEvent["kind"], detail: string) {
  if (rec.environment === "sandbox") return;
  await pushTraffic({ at: rec.updatedAt, taskId: rec.id, kind, peer: rec.peer.name, detail });
}

export function provisionEnclave(input: ProvisionInput): EnclaveRecord {
  const at = input.now ?? new Date();
  const id = input.id ?? randomId("xch_", 15);
  const screened = screenPayload({ message: input.message, item: input.item.description });
  const card = input.peerCard ? scanAgentCard(input.peerCard) : null;
  const threats = [...(card?.threats ?? []), ...screened.threats];
  // A poisoned card condemns the whole payload: its message is quarantined along with it.
  const verdict = verdictFor(threats);
  const shield = shieldAssess(threats, input.probes);
  const alloc = allocate(input.initiator.resources, input.counterparty.resources);
  const vault = sealVault(id, input.initiator, input.counterparty, { initiator: randomHex(), counterparty: randomHex() }, alloc && alloc.shortfalls.length === 0 ? alloc.allocation : null);
  const peerName = (card?.name !== "external-agent" ? card?.name : undefined) ?? (input.peerName.replace(/[^\w .@:/-]/g, "").slice(0, 80) || "external-agent");
  const rec: EnclaveRecord = {
    id,
    contextId: `ctx_${id.slice(4)}`,
    createdAt: at.toISOString(),
    updatedAt: at.toISOString(),
    owner: input.owner,
    environment: input.environment,
    source: input.source,
    origin: input.origin,
    peer: { name: peerName, framework: input.framework },
    item: { ...input.item, description: screened.fields.item || input.item.description },
    preferredRail: input.preferredRail,
    vault,
    state: "submitted",
    statusReason: null,
    counterpartyMessage: verdict === "quarantined" ? (screened.clean ? QUARANTINED : "") : screened.clean,
    rounds: [],
    operatorRounds: [],
    security: { trust: shield.trust, posture: shield.posture, verdict, threats },
    signals: [],
    restructures: [],
    allocation: alloc,
    aether: null,
    exception: null,
    agreedTerms: null,
    certificate: null,
    decision: null,
    dispatch: null,
    usage: { input: 0, output: 0, liveTurns: 0, model: "apex/deterministic-v1" },
    events: [],
  };
  event(rec, { audience: "public", type: "enclave.provisioned", taskId: id, environment: rec.environment, source: rec.source, peer: rec.peer.name }, at);
  event(rec, { audience: "public", type: "firewall.scan", verdict, threats: threats.map((t) => ({ vector: t.vector, severity: t.severity, field: t.field })) }, at);
  event(rec, { audience: "operator", type: "engine.signal", engine: "shield", text: [`Counterparty trust ${shield.trust}/100 (${shield.posture}).`, ...shield.notes].join(" ") }, at);
  if (alloc) {
    const offers = input.initiator.resources ?? {};
    const granted = Object.entries(alloc.allocation).map(([d, q]) => `${d} ${q.toLocaleString("en-US")} ${RESOURCE_UNITS[d as keyof typeof RESOURCE_UNITS]}`);
    const floor = resourceFloorUsd(offers, alloc.allocation);
    if (granted.length) event(rec, { audience: "operator", type: "engine.signal", engine: "sovereign", text: `Resource allocation: ${granted.join(" · ")}${alloc.clamped.length ? ` (clamped to capacity: ${alloc.clamped.join(", ")})` : ""}. Resource floor ${usd(floor)}.` }, at);
    // Asking for far more than exists is a hoarding / swarm-reservation pattern: Cortex flags it for the operator.
    const hoarded = Object.entries(input.counterparty.resources ?? {}).filter(([d, r]) => r && r.quantity > 2 * (offers[d as keyof typeof offers]?.capacity ?? 0));
    if (hoarded.length) {
      const detail = `Requested more than twice available capacity on ${hoarded.map(([d]) => d).join(", ")}: hoarding pattern, grants capped at capacity.`;
      rec.signals.push({ kind: "hoarding", round: 0, detail });
      event(rec, { audience: "operator", type: "engine.signal", engine: "cortex", text: detail }, at);
    }
  }
  return rec;
}

const EXTERNAL_REASON: Record<ExceptionKind, string> = {
  out_of_bounds: "Your final counter-offer falls outside the provider's standing mandate. Escalated to the provider's executive; you may send a revised mandate to this task.",
  above_auto_settle: "Agreed terms await the provider's executive sign-off.",
  sla_infeasible: "The required SLA tier is not available under the provider's standing mandate.",
  resource_bounds: "The requested resources exceed what the provider's standing mandate can commit. You may send a revised mandate to this task.",
};
export const externalReason = (k: ExceptionKind) => EXTERNAL_REASON[k];

async function setState(rec: EnclaveRecord, state: TaskState, at: Date, reason: string | null, deps?: Hooks) {
  rec.state = state;
  rec.statusReason = reason;
  event(rec, { audience: "public", type: "state", state, ...(reason && { reason }) }, at, deps);
  await saveTask(rec);
}

async function raise(rec: EnclaveRecord, kind: ExceptionKind, detail: string, counterTerms: Terms | null, deps?: Hooks) {
  const at = now(deps);
  rec.exception = { kind, detail, counterTerms };
  event(rec, { audience: "operator", type: "exception", kind }, at, deps);
  await setState(rec, "input_required", at, EXTERNAL_REASON[kind], deps);
  if (kind === "out_of_bounds") await recordProbe(rec.owner);
  await traffic(rec, "exception", `${kind.replace(/_/g, " ")} · ${rec.item.description.slice(0, 60)}`);
}

async function settle(rec: EnclaveRecord, terms: Terms, override: boolean, deps?: Hooks) {
  const at = now(deps);
  try {
    const cert = mintCertificate({
      taskId: rec.id,
      contextId: rec.contextId,
      environment: rec.environment,
      source: rec.source,
      origin: rec.origin,
      peer: rec.peer,
      item: rec.item,
      terms,
      rounds: rec.rounds,
      vault: rec.vault,
      security: { trustScore: rec.security.trust, verdict: rec.security.verdict, threatsNeutralized: rec.security.threats.length },
      override,
      preferredRail: rec.preferredRail,
      issuedAt: at,
    });
    rec.certificate = cert;
    rec.agreedTerms = terms;
    rec.aether = aetherProof(terms, rec.vault.initiator, rec.restructures, resourceFloorUsd(rec.vault.initiator.resources, rec.vault.allocation));
    event(rec, { audience: "operator", type: "engine.signal", engine: "aether", text: `Margin proof: ${rec.aether.realizedMarginPct}% realized vs ${rec.aether.minMarginPct}% floor (${rec.aether.pvAdjustedMarginPct}% after net-${terms.netDays} time value).` }, at, deps);
    event(rec, { audience: "operator", type: "engine.signal", engine: "sovereign", text: `Terms verified against both sealed mandates${override ? " (executive override recorded)" : ""}. Certificate signed ${cert.signature.kid}.` }, at, deps);
    event(rec, { audience: "public", type: "settled", certificateId: cert.certificateId, priceUsd: terms.priceUsd }, at, deps);
    rec.dispatch = await dispatchSettlement(cert);
    await setState(rec, "completed", at, null, deps);
    if (rec.environment !== "sandbox") await addToLedger(rec.id);
    await traffic(rec, "settled", `${cert.certificateId} · ${usd(terms.priceUsd)}`);
  } catch (err) {
    if (!(err instanceof SettlementRefused)) throw err;
    event(rec, { audience: "operator", type: "engine.signal", engine: "sovereign", text: `Settlement refused: ${err.message}` }, at, deps);
    await setState(rec, "failed", at, "Settlement refused by mandate verification.", deps);
  }
}

/** Negotiates to an outcome. Safe to call once per session; resumed sessions call it again with new rounds appended. */
export async function runEnclave(rec: EnclaveRecord, deps: RunDeps): Promise<EnclaveRecord> {
  const pace = deps.pacingMs ? () => new Promise<void>((r) => setTimeout(r, deps.pacingMs)) : async () => {};
  await setState(rec, "working", now(deps), null, deps);
  if (rec.environment !== "sandbox" && rec.rounds.length === 0) {
    await traffic(rec, "handshake", `${rec.peer.framework} agent · ${rec.item.description.slice(0, 60)}`);
    if (rec.security.threats.length) {
      await traffic(rec, "blocked", `${rec.security.threats.length} vector${rec.security.threats.length === 1 ? "" : "s"} neutralized (${rec.security.verdict})`);
      const vectors: Record<string, number> = {};
      for (const t of rec.security.threats) vectors[t.vector] = (vectors[t.vector] ?? 0) + 1;
      await pushAudit({ at: rec.updatedAt, taskId: rec.id, peer: rec.peer.name, verdict: rec.security.verdict, vectors }, sha256Hex);
    }
  }

  if (rec.allocation?.shortfalls.length) {
    const s = rec.allocation.shortfalls.map((x) => `${x.dimension}: needs ≥ ${x.minimum.toLocaleString("en-US")}, capacity ${x.available.toLocaleString("en-US")}`);
    await raise(rec, "resource_bounds", `Resource request outside standing capacity (${s.join("; ")}).`, null, deps);
    return rec;
  }

  const policy = counterpartyPolicy(rec.vault);
  if (!slaFeasible(policy.requiredSlaTier, rec.vault.initiator.maxSlaTier)) {
    await raise(rec, "sla_infeasible", `Client requires ${policy.requiredSlaTier} SLA; standing mandate offers up to ${rec.vault.initiator.maxSlaTier}.`, null, deps);
    return rec;
  }

  const result = await negotiate(
    { vault: rec.vault, trust: rec.security.trust, posture: rec.security.posture, counterpartyMessage: rec.counterpartyMessage, apex: deps.apex, maxTurns: deps.maxTurns, prior: rec.rounds },
    {
      now: () => now(deps),
      pace,
      isCanceled: () => cancelRequested(rec.id),
      onRound: async (round, detail) => {
        rec.rounds.push(round);
        if (detail) rec.operatorRounds.push(detail);
        event(rec, { audience: "public", type: "round", round }, now(deps), deps);
        await saveTask(rec);
      },
      onSignal: async (engine, text) => {
        event(rec, { audience: "operator", type: "engine.signal", engine, text }, now(deps), deps);
      },
      onClamp: async (round, clamps) => {
        event(rec, { audience: "operator", type: "clamp", engine: "sovereign", round, reasons: clamps.map((c) => `${c.rule}: ${c.from} → ${c.to}`) }, now(deps), deps);
      },
    },
  );
  // negotiate() works on its own copy of the chain; the record's copy was kept in step by onRound.
  // Keep signals raised before negotiation (resource hoarding) alongside the negotiation's own.
  rec.signals = [...rec.signals.filter((s) => s.kind === "hoarding"), ...result.signals];
  rec.restructures.push(...result.restructures);
  rec.usage = { input: rec.usage.input + result.usage.input, output: rec.usage.output + result.usage.output, liveTurns: rec.usage.liveTurns + result.usage.liveTurns, model: result.model };

  if (result.outcome === "canceled") {
    await setState(rec, "canceled", now(deps), "Canceled by the client.", deps);
    return rec;
  }
  if (result.outcome === "no_agreement" || !result.terms) {
    const last = result.lastCounter;
    const floor = initiatorFloor(rec.vault);
    const gap = last ? `Final counter ${usd(last.priceUsd)} is ${(((floor - last.priceUsd) / floor) * 100).toFixed(1)}% below the effective floor ${usd(floor)}.` : "No counter-offer.";
    await raise(rec, "out_of_bounds", gap, last, deps);
    return rec;
  }
  const terms = result.terms;
  if (terms.priceUsd > rec.vault.initiator.autoSettleCeilingUsd) {
    rec.agreedTerms = terms;
    await raise(rec, "above_auto_settle", `Agreed ${usd(terms.priceUsd)} exceeds the auto-settlement ceiling ${usd(rec.vault.initiator.autoSettleCeilingUsd)}.`, terms, deps);
    return rec;
  }
  await settle(rec, terms, false, deps);
  return rec;
}

/** The executive's call on an exception: override settles (signed and recorded as such), reject closes the task. */
export async function decideException(rec: EnclaveRecord, action: "override" | "reject", by: string, deps?: { now?: () => Date }): Promise<EnclaveRecord> {
  if (rec.state !== "input_required" || !rec.exception) throw new Error("This task has no open exception.");
  const at = now(deps);
  rec.decision = { action, by, at: at.toISOString() };
  if (action === "reject" || !rec.exception.counterTerms) {
    if (action === "override") throw new Error("This exception has no terms to settle on; reject it instead.");
    event(rec, { audience: "operator", type: "engine.signal", engine: "sovereign", text: `Exception rejected by ${by}.` }, at);
    await setState(rec, "failed", at, "Rejected by the provider's executive.");
    await traffic(rec, "rejected", rec.item.description.slice(0, 60));
    return rec;
  }
  const terms = rec.exception.counterTerms;
  const outOfBounds = rec.exception.kind === "out_of_bounds";
  if (outOfBounds) {
    const check = verifySettlement(terms, rec.vault, true);
    if (check.counterparty !== "within_mandate") throw new Error("Counter terms violate the client's own mandate.");
    const round = chainRound(rec.rounds, "initiator", terms, `Accepted by executive override: ${usd(terms.priceUsd)}, net ${terms.netDays}, ${terms.slaTier} SLA.`, at);
    rec.rounds.push(round);
    rec.operatorRounds.push({ n: round.n, plan: terms, proposal: null, clamps: [], model: `executive/${by}`, beta: 0 });
    event(rec, { audience: "public", type: "round", round }, at);
  }
  event(rec, { audience: "operator", type: "engine.signal", engine: "sovereign", text: `${outOfBounds ? "Executive override" : "Executive approval"} by ${by}.` }, at);
  await settle(rec, terms, outOfBounds, deps);
  return rec;
}

/** A revised client mandate on an input_required task reopens the negotiation on the same chain. */
export async function resumeEnclave(rec: EnclaveRecord, counterparty: CounterpartyMandate, message: string, deps: RunDeps): Promise<EnclaveRecord> {
  if (rec.state !== "input_required") throw new Error("Only a task awaiting input can be resumed.");
  const screened = screenPayload({ message });
  rec.security.threats.push(...screened.threats);
  rec.security = { ...rec.security, ...shieldAssess(rec.security.threats, 0), verdict: screened.verdict === "clean" ? rec.security.verdict : screened.verdict, threats: rec.security.threats };
  event(rec, { audience: "public", type: "firewall.scan", verdict: screened.verdict, threats: screened.threats.map((t) => ({ vector: t.vector, severity: t.severity, field: t.field })) }, now(deps), deps);
  rec.allocation = allocate(rec.vault.initiator.resources, counterparty.resources);
  rec.vault = { ...rec.vault, counterparty, salts: { ...rec.vault.salts, counterparty: randomHex() }, allocation: rec.allocation && rec.allocation.shortfalls.length === 0 ? rec.allocation.allocation : null };
  rec.counterpartyMessage = screened.clean;
  rec.exception = null;
  rec.agreedTerms = null;
  return runEnclave(rec, deps);
}

/** Flags the task; a running enclave stops at its next turn, an idle (input_required) one closes now. */
export async function cancelEnclave(rec: EnclaveRecord): Promise<EnclaveRecord> {
  if (TERMINAL.includes(rec.state)) throw new Error("Task is already final.");
  await requestCancel(rec.id);
  if (rec.state === "input_required" || rec.state === "submitted") await setState(rec, "canceled", new Date(), "Canceled by the client.");
  return rec;
}
