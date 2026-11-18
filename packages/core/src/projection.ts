import { aetherProof } from "./bloom-bridge.ts";
import { sha256Hex } from "./crypto.ts";
import { resourceFloorUsd, resourceProofs } from "./resources.ts";
import type { EnclaveRecord } from "./enclave.ts";
import type { ExchangeEvent, OperatorView, PublicRound } from "./types.ts";

/**
 * The only two ways an enclave record leaves the server. Both are whitelists built field by field, never spreads
 * of the record, so a field added to the record later cannot leak by default.
 *   toA2ATask    what the external agent gets: public rounds, public events, the certificate. No mandate figures.
 *   operatorView what the provider's command surface gets: its own mandate and reasoning, never the client's limits.
 */

export type A2APart = { kind: "text"; text: string } | { kind: "data"; data: Record<string, unknown> };
export type A2AMessage = { kind: "message"; messageId: string; role: "user" | "agent"; parts: A2APart[]; taskId: string; contextId: string };
export type A2ATask = {
  kind: "task";
  id: string;
  contextId: string;
  status: { state: EnclaveRecord["state"]; timestamp: string; message?: A2AMessage };
  history: A2AMessage[];
  artifacts: { artifactId: string; name: string; description: string; parts: A2APart[] }[];
  metadata: Record<string, unknown>;
};

export const publicEvents = (rec: EnclaveRecord): ExchangeEvent[] => rec.events.filter((e) => e.audience === "public");

export function roundMessage(rec: Pick<EnclaveRecord, "id" | "contextId">, r: PublicRound): A2AMessage {
  return {
    kind: "message",
    messageId: `${rec.id}:r${r.n}`,
    role: r.by === "counterparty" ? "user" : "agent",
    taskId: rec.id,
    contextId: rec.contextId,
    parts: [
      { kind: "text", text: r.message },
      { kind: "data", data: { round: { n: r.n, by: r.by, terms: r.terms, message: r.message, at: r.at, prevHash: r.prevHash, hash: r.hash } } },
    ],
  };
}

function statusText(rec: EnclaveRecord): string {
  switch (rec.state) {
    case "completed":
      return rec.certificate ? `Settled: ${rec.certificate.certificateId}.` : "Settled.";
    case "input_required":
      return rec.statusReason ?? "Awaiting input.";
    case "failed":
    case "canceled":
      return rec.statusReason ?? rec.state;
    default:
      return `Negotiating: ${rec.rounds.length} round${rec.rounds.length === 1 ? "" : "s"}.`;
  }
}

export function toA2ATask(rec: EnclaveRecord, historyLength?: number): A2ATask {
  const rounds = historyLength !== undefined ? rec.rounds.slice(-Math.max(0, historyLength)) : rec.rounds;
  const counts: Record<string, number> = {};
  for (const t of rec.security.threats) counts[t.vector] = (counts[t.vector] ?? 0) + 1;
  const cert = rec.certificate;
  return {
    kind: "task",
    id: rec.id,
    contextId: rec.contextId,
    status: {
      state: rec.state,
      timestamp: rec.updatedAt,
      message: { kind: "message", messageId: `${rec.id}:status:${rec.events.length}`, role: "agent", taskId: rec.id, contextId: rec.contextId, parts: [{ kind: "text", text: statusText(rec) }] },
    },
    history: rounds.map((r) => roundMessage(rec, r)),
    artifacts: cert
      ? [{ artifactId: cert.certificateId, name: "bloom-settlement-certificate", description: "Signed BLOOM-XCH settlement certificate with AP2 checkout and payment mandates.", parts: [{ kind: "data", data: cert as unknown as Record<string, unknown> }] }]
      : [],
    metadata: {
      "bloom.environment": rec.environment,
      "bloom.source": rec.source,
      "bloom.rounds": rec.rounds.length,
      "bloom.firewall": { verdict: rec.security.verdict, vectors: counts },
      ...(rec.vault.allocation && { "bloom.allocation": rec.vault.allocation }),
      ...(rec.state === "input_required" && { "bloom.awaiting": rec.exception?.kind === "out_of_bounds" ? "revised_mandate_or_executive" : rec.exception?.kind === "sla_infeasible" || rec.exception?.kind === "resource_bounds" ? "revised_mandate" : "executive_signoff" }),
    },
  };
}

export function operatorView(rec: EnclaveRecord): OperatorView {
  return {
    taskId: rec.id,
    contextId: rec.contextId,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    state: rec.state,
    statusReason: rec.statusReason,
    environment: rec.environment,
    source: rec.source,
    peer: { name: rec.peer.name, framework: rec.peer.framework },
    item: rec.item,
    initiatorMandate: rec.vault.initiator,
    rounds: rec.rounds,
    operatorRounds: rec.operatorRounds,
    security: { trust: rec.security.trust, posture: rec.security.posture, verdict: rec.security.verdict, threats: rec.security.threats },
    signals: rec.signals,
    aether: rec.aether ?? (rec.agreedTerms ? aetherProof(rec.agreedTerms, rec.vault.initiator, rec.restructures, resourceFloorUsd(rec.vault.initiator.resources, rec.vault.allocation)) : null),
    resources: rec.certificate?.resources ?? (rec.vault.allocation ? { allocation: rec.vault.allocation, proofs: resourceProofs(rec.vault.initiator.resources, rec.vault.counterparty.resources, rec.vault.allocation, rec.vault.salts.initiator, sha256Hex) } : null),
    exception: rec.exception ? { kind: rec.exception.kind, detail: rec.exception.detail, counterTerms: rec.exception.counterTerms } : null,
    agreedTerms: rec.agreedTerms,
    certificate: rec.certificate,
    decision: rec.decision,
    events: rec.events,
  };
}

/** One ledger row for lists. */
export function operatorSummary(rec: EnclaveRecord) {
  return {
    taskId: rec.id,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    state: rec.state,
    environment: rec.environment,
    source: rec.source,
    peer: rec.peer,
    item: rec.item.description,
    rounds: rec.rounds.length,
    priceUsd: rec.certificate?.terms.priceUsd ?? rec.agreedTerms?.priceUsd ?? rec.exception?.counterTerms?.priceUsd ?? null,
    certificateId: rec.certificate?.certificateId ?? null,
    exception: rec.exception?.kind ?? null,
    trust: rec.security.trust,
    threats: rec.security.threats.length,
  };
}
export type OperatorSummary = ReturnType<typeof operatorSummary>;
