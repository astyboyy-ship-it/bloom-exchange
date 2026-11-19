import { SLA_TIERS, type ExceptionKind, type ExchangeEvent, type Side, type SlaTier, type ThreatVector } from "../types.ts";
import type { EnclaveRecord } from "../enclave.ts";
import type { BloomEventDraft, ClampRule } from "./types.ts";

/**
 * The only way an internal ExchangeEvent becomes a BloomEvent. A whitelist built field by field, like
 * projection.ts: every value is re-typed and re-validated here, so a field added to the record or to an internal
 * event later cannot reach an adapter by default.
 *
 * Never projected:
 *   engine.signal  free text (margin proofs, trust notes, resource floors)
 *   clamp values   `mandate_floor: 41,210 → 41,450` would reveal the floor, so only rule names survive
 *   exception text names the effective floor and the gap; only the kind survives
 *   round messages model output, even scrubbed
 */

const CLAMP_RULES: readonly ClampRule[] = ["mandate_floor", "anchor_cap", "regression", "concession_rate", "net_terms", "sla_tier", "dominated", "invalid"];
const EXCEPTIONS: readonly ExceptionKind[] = ["out_of_bounds", "above_auto_settle", "sla_infeasible", "resource_bounds"];
const HEX64 = /^[0-9a-f]{64}$/;
const CERT_ID = /^BLOOM-XCH-[0-9A-Z]{4}(?:-[0-9A-Z]{4}){3}$/;
const KID = /^bxk-[0-9a-f]{16}$/;

const num = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) ? n : null);
const hex = (s: unknown): string | null => (typeof s === "string" && HEX64.test(s) ? s : null);
const side = (s: unknown): Side | null => (s === "initiator" || s === "counterparty" ? s : null);
const sla = (s: unknown): SlaTier | null => ((SLA_TIERS as readonly unknown[]).includes(s) ? (s as SlaTier) : null);
const httpUrl = (s: unknown): string | null => {
  if (typeof s !== "string" || s.length > 300) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
};

export function toBloomDrafts(rec: EnclaveRecord, e: ExchangeEvent): BloomEventDraft[] {
  const base = { at: e.at, taskId: rec.id, contextId: rec.contextId, environment: rec.environment };
  switch (e.type) {
    case "enclave.provisioned":
      return [{ ...base, type: "negotiation.opened", data: { framework: rec.peer.framework, source: rec.source } }];

    case "firewall.scan": {
      const vectors: Partial<Record<ThreatVector, number>> = {};
      for (const t of e.threats) vectors[t.vector] = (vectors[t.vector] ?? 0) + 1;
      return [{ ...base, type: "firewall.scanned", data: { verdict: e.verdict, vectors } }];
    }

    case "round": {
      const r = e.round;
      const priceUsd = num(r.terms.priceUsd);
      const netDays = num(r.terms.netDays);
      const by = side(r.by);
      const slaTier = sla(r.terms.slaTier);
      const hash = hex(r.hash);
      const prevHash = hex(r.prevHash);
      if (priceUsd === null || netDays === null || !by || !slaTier || !hash || !prevHash || num(r.n) === null) return [];
      return [{ ...base, type: "offer.updated", data: { round: r.n, by, priceUsd, netDays, slaTier, hash, prevHash } }];
    }

    case "clamp": {
      // Reasons look like "mandate_floor: 41210 → 41450"; keep the rule name and drop everything after it.
      const rules = [...new Set(e.reasons.map((s) => s.split(":", 1)[0].trim()))].filter((r): r is ClampRule => (CLAMP_RULES as readonly string[]).includes(r));
      if (!rules.length || num(e.round) === null) return [];
      return [{ ...base, type: "negotiation.clamped", data: { round: e.round, rules } }];
    }

    case "exception":
      return EXCEPTIONS.includes(e.kind) ? [{ ...base, type: "negotiation.exception", data: { kind: e.kind } }] : [];

    case "settled": {
      const c = rec.certificate;
      if (!c || c.certificateId !== e.certificateId || !CERT_ID.test(c.certificateId)) return [];
      const digest = hex(c.digest);
      const chainHead = hex(c.rounds.chainHead);
      const issuerCard = httpUrl(c.issuer.agentCard);
      const slaTier = sla(c.terms.slaTier);
      const priceUsd = num(c.terms.priceUsd);
      const netDays = num(c.terms.netDays);
      if (!digest || !chainHead || !issuerCard || !slaTier || priceUsd === null || netDays === null || !KID.test(c.signature.kid)) return [];
      const binding = c.settlement.binding === true;
      return [
        { ...base, type: "negotiation.settled", data: { certificateId: c.certificateId, priceUsd, netDays, slaTier, rounds: c.rounds.count, binding } },
        { ...base, type: "receipt.issued", data: { certificateId: c.certificateId, digest, kid: c.signature.kid, issuerCard, chainHead, binding } },
      ];
    }

    case "state":
      return e.state === "failed" || e.state === "canceled" ? [{ ...base, type: "negotiation.closed", data: { state: e.state } }] : [];

    default:
      return [];
  }
}
