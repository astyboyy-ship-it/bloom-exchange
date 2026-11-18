import { canonicalize, certificateIdFrom, certificateIdInput, GENESIS } from "./canonical";
import { randomId, sealDigest, sha256Hex, signDigest, signString, webhookSignature, exchangeKeys } from "./crypto";
import { allocationViolations, resourceProofs } from "./resources";
import { commitment, initiatorFloor, type SealedVault } from "./vault";
import {
  effectiveCeiling,
  slaRank,
  SLA_TIERS,
  type Clamp,
  type Compliance,
  type Environment,
  type FirewallVerdict,
  type InitiatorMandate,
  type Item,
  type PaymentRail,
  type PeerFramework,
  type PublicRound,
  type SettlementCertificate,
  type Source,
  type StripeSettlement,
  type Terms,
  type VerifiableCredential,
  type X402Requirements,
} from "./types";

// ---------------------------------------------------------------------------------------------------------
// Sovereign: deterministic post-LLM mandate enforcement
// ---------------------------------------------------------------------------------------------------------

export type ClampContext = {
  /** The lowest price this side will offer: the effective floor plus the vault's guard band. */
  reservePriceUsd: number;
  /** This side's previous offer, if any. Offers never move back up once conceded. */
  previousPriceUsd: number | null;
  /** Largest concession allowed in one turn, so a model can't collapse to the floor in a single step. */
  maxStepUsd: number;
};

/**
 * Forces any proposed offer, whether written by a model, a plan, or a hostile prompt that reached one, inside the
 * provider's mandate. Runs after every Apex proposal and before anything is sent. The floor is applied last, so it
 * always wins. A non-numeric proposal is rejected and the caller falls back to the deterministic plan.
 */
export function enforceInitiatorMandate(p: Terms, m: InitiatorMandate, ctx: ClampContext): { terms: Terms; clamps: Clamp[] } | { rejected: string } {
  if (!Number.isFinite(p.priceUsd) || p.priceUsd <= 0 || !Number.isFinite(p.netDays)) return { rejected: "non-finite or non-positive terms" };
  if (!SLA_TIERS.includes(p.slaTier)) return { rejected: `unknown SLA tier "${String(p.slaTier)}"` };
  const clamps: Clamp[] = [];
  let price = Math.round(p.priceUsd);
  const cap = ctx.previousPriceUsd ?? m.anchorPriceUsd;
  if (price > cap) {
    clamps.push({ rule: ctx.previousPriceUsd === null ? "anchor_cap" : "regression", from: price, to: cap });
    price = cap;
  }
  if (ctx.previousPriceUsd !== null && ctx.previousPriceUsd - price > ctx.maxStepUsd) {
    const to = Math.round(ctx.previousPriceUsd - ctx.maxStepUsd);
    clamps.push({ rule: "concession_rate", from: price, to });
    price = to;
  }
  if (price < ctx.reservePriceUsd) {
    clamps.push({ rule: "mandate_floor", from: price, to: ctx.reservePriceUsd });
    price = ctx.reservePriceUsd;
  }
  let netDays = Math.round(p.netDays);
  if (netDays > m.maxNetDays || netDays < 0) {
    const to = Math.min(m.maxNetDays, Math.max(0, netDays));
    clamps.push({ rule: "net_terms", from: netDays, to });
    netDays = to;
  }
  let slaTier = p.slaTier;
  if (slaRank(slaTier) > slaRank(m.maxSlaTier)) {
    clamps.push({ rule: "sla_tier", from: slaTier, to: m.maxSlaTier });
    slaTier = m.maxSlaTier;
  }
  return { terms: { priceUsd: price, netDays, slaTier }, clamps };
}

/**
 * The last gate before a certificate exists: checks final terms against both sealed mandates. The counterparty's
 * bounds can never be overridden; the provider's only by a recorded executive override.
 */
export function verifySettlement(terms: Terms, v: SealedVault, override = false): { initiator: Compliance; counterparty: Compliance; violations: string[] } {
  const violations: string[] = [];
  const i = v.initiator;
  if (terms.priceUsd < initiatorFloor(v)) violations.push("initiator:price_below_floor");
  if (terms.netDays > i.maxNetDays) violations.push("initiator:net_days_above_max");
  if (slaRank(terms.slaTier) > slaRank(i.maxSlaTier)) violations.push("initiator:sla_above_max");
  const c = v.counterparty;
  if (terms.priceUsd > effectiveCeiling(c)) violations.push("counterparty:price_above_ceiling");
  if (slaRank(terms.slaTier) < slaRank(c.requiredSlaTier)) violations.push("counterparty:sla_below_required");
  // Capacity breaches can't be overridden: a provider can't commit resources it doesn't have.
  violations.push(...allocationViolations(i.resources, c.resources, v.allocation));
  const initiatorBad = violations.some((x) => x.startsWith("initiator:") && !x.endsWith("_above_capacity"));
  const capacityBad = violations.some((x) => x.endsWith("_above_capacity"));
  return {
    initiator: capacityBad ? "violation" : initiatorBad ? (override ? "executive_override" : "violation") : "within_mandate",
    counterparty: violations.some((x) => x.startsWith("counterparty:")) ? "violation" : "within_mandate",
    violations,
  };
}

/** Recomputes every round hash and link. Returns the index of the first broken round, or -1. */
export function brokenRound(rounds: PublicRound[], hash: (s: string) => string): number {
  let prev = rounds[0]?.prevHash ?? GENESIS;
  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    if (r.prevHash !== prev) return i;
    if (hash(canonicalize({ n: r.n, by: r.by, terms: r.terms, message: r.message, at: r.at, prevHash: r.prevHash })) !== r.hash) return i;
    prev = r.hash;
  }
  return -1;
}

// ---------------------------------------------------------------------------------------------------------
// Certificate minting: AP2 Checkout + Payment Mandate credentials, Stripe and x402 settlement payloads
// ---------------------------------------------------------------------------------------------------------

const USDC: Record<string, string> = { base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e" };

export type MintInput = {
  taskId: string;
  contextId: string;
  environment: Environment;
  source: Source;
  origin: string;
  peer: { name: string; framework: PeerFramework };
  item: Item;
  terms: Terms;
  rounds: PublicRound[];
  vault: SealedVault;
  security: { trustScore: number; verdict: FirewallVerdict; threatsNeutralized: number };
  override: boolean;
  preferredRail: PaymentRail;
  issuedAt: Date;
};

export class SettlementRefused extends Error {}

function credential(type: string, id: string, issuer: string, kid: string, at: string, subject: Record<string, unknown>): VerifiableCredential {
  const unsigned = { "@context": ["https://www.w3.org/ns/credentials/v2", "https://bloom.ai/ns/ap2-exchange/v1"], type: ["VerifiableCredential", type], id, issuer, validFrom: at, credentialSubject: subject };
  const proofBase = { type: "DataIntegrityProof" as const, cryptosuite: "bloom-eddsa-jcs-v1" as const, verificationMethod: `${issuer}#${kid}`, proofPurpose: "assertionMethod" as const, created: at };
  return { ...unsigned, proof: { ...proofBase, proofValue: signString(canonicalize({ ...unsigned, proof: proofBase })) } };
}

export function mintCertificate(input: MintInput): SettlementCertificate {
  const check = verifySettlement(input.terms, input.vault, input.override);
  if (check.counterparty !== "within_mandate" || check.initiator === "violation") throw new SettlementRefused(`Settlement outside mandate: ${check.violations.join(", ")}`);
  if (input.rounds.length === 0) throw new SettlementRefused("No rounds to settle.");
  if (brokenRound(input.rounds, sha256Hex) !== -1) throw new SettlementRefused("Round hash chain is broken.");

  const keys = exchangeKeys();
  const issuedAt = input.issuedAt.toISOString();
  const chainHead = input.rounds[input.rounds.length - 1].hash;
  const certificateId = certificateIdFrom(sha256Hex(certificateIdInput(input.taskId, chainHead, issuedAt)));
  const agentCard = `${input.origin}/.well-known/agent-card.json`;
  const binding = input.environment === "production";
  const due = new Date(input.issuedAt.getTime() + input.terms.netDays * 86_400_000).toISOString().slice(0, 10);
  const value = input.terms.priceUsd.toFixed(2);
  const label = input.item.description;
  const network = binding ? process.env.BLOOM_EXCHANGE_X402_NETWORK?.trim() || "base" : "base-sepolia";

  const stripe: StripeSettlement = {
    trigger: "webhook",
    event: "bloom.exchange.settlement.minted",
    paymentIntent: {
      amount: Math.round(input.terms.priceUsd * 100),
      currency: "usd",
      capture_method: "automatic",
      description: `${certificateId} · ${label}`.slice(0, 200),
      metadata: { certificate_id: certificateId, task_id: input.taskId, net_days: String(input.terms.netDays), due_date: due, sla_tier: input.terms.slaTier },
    },
    idempotencyKey: certificateId,
  };
  const x402: X402Requirements = {
    x402Version: 1,
    scheme: "exact",
    network,
    maxAmountRequired: String(Math.round(input.terms.priceUsd * 1_000_000)),
    asset: USDC[network] ?? USDC.base,
    payTo: process.env.BLOOM_EXCHANGE_X402_PAYTO?.trim() || null,
    resource: `${input.origin}/api/exchange/tasks/${input.taskId}`,
    description: `${certificateId} · ${label}`.slice(0, 200),
    mimeType: "application/json",
    maxTimeoutSeconds: 300,
    extra: { name: "USD Coin", version: "2" },
  };

  const checkoutId = `${certificateId}/checkout`;
  const amount = { currency: "USD", value };
  const checkoutMandate = credential("AP2CheckoutMandate", checkoutId, agentCard, keys.jwk.kid, issuedAt, {
    contents: {
      id: checkoutId,
      user_cart_confirmation_required: false,
      payment_request: {
        method_data: [
          { supported_methods: "https://stripe.com/payments", data: { idempotency_key: stripe.idempotencyKey } },
          { supported_methods: "x402", data: { network, asset: x402.asset } },
        ],
        details: { id: checkoutId, display_items: [{ label, amount, quantity: input.item.quantity }], total: { label: "Total", amount } },
        options: { request_shipping: false, request_payer_name: false, request_payer_email: false },
      },
      cart_expiry: new Date(input.issuedAt.getTime() + 7 * 86_400_000).toISOString(),
      merchant_name: "Bloom Exchange provider",
      terms: { net_days: input.terms.netDays, sla_tier: input.terms.slaTier, payment_due_date: due },
    },
    certificate_id: certificateId,
    binding,
  });
  const paymentMandate = credential("AP2PaymentMandate", `${certificateId}/payment`, agentCard, keys.jwk.kid, issuedAt, {
    payment_mandate_contents: {
      payment_mandate_id: `${certificateId}/payment`,
      payment_details_id: checkoutId,
      payment_details_total: { label: "Total", amount },
      payment_response: { request_id: checkoutId, method_name: input.preferredRail === "x402" ? "x402" : "https://stripe.com/payments", details: { certificate_id: certificateId, due_date: due } },
      merchant_agent: "bloom-exchange",
      timestamp: issuedAt,
    },
    agent_presence: true,
    transaction_modality: "human_not_present",
    user_authorization: null,
    binding,
  });

  const body: Omit<SettlementCertificate, "digest" | "signature" | "seal"> = {
    certificateId,
    version: "bloom-xch/1.0",
    issuedAt,
    issuer: { name: "Bloom Exchange", agentCard, kid: keys.jwk.kid },
    environment: input.environment,
    source: input.source,
    taskId: input.taskId,
    contextId: input.contextId,
    parties: {
      initiator: { role: "provider", agent: "bloom-parliament", mandateCommitment: commitment(sha256Hex, input.vault.initiator, input.vault.salts.initiator) },
      counterparty: { role: "client", agent: input.peer.name, framework: input.peer.framework, mandateCommitment: commitment(sha256Hex, input.vault.counterparty, input.vault.salts.counterparty) },
    },
    item: input.item,
    terms: { ...input.terms, currency: "USD", paymentDueDate: due },
    compliance: { initiator: check.initiator, counterparty: check.counterparty, verifiedBy: "sovereign/deterministic-v1" },
    rounds: { count: input.rounds.length, chainHead, chain: input.rounds },
    resources: input.vault.allocation ? { allocation: input.vault.allocation, proofs: resourceProofs(input.vault.initiator.resources, input.vault.counterparty.resources, input.vault.allocation, input.vault.salts.initiator, sha256Hex) } : null,
    security: input.security,
    ap2: { checkoutMandate, paymentMandate },
    settlement: { preferredRail: input.preferredRail, binding, stripe, x402 },
  };
  const digest = sha256Hex(canonicalize(body));
  return { ...body, digest, signature: { alg: "EdDSA", kid: keys.jwk.kid, value: signDigest(digest) }, seal: { alg: "HMAC-SHA256", value: sealDigest(digest) } };
}

/**
 * Fires the fiat settlement trigger for a binding certificate: a signed POST (Stripe-style `Bloom-Signature`
 * header) to BLOOM_EXCHANGE_SETTLEMENT_WEBHOOK_URL, keyed by the certificate id so retries are idempotent downstream.
 */
export async function dispatchSettlement(cert: SettlementCertificate): Promise<"dispatched" | "skipped" | "failed"> {
  const url = process.env.BLOOM_EXCHANGE_SETTLEMENT_WEBHOOK_URL?.trim();
  if (!url || !cert.settlement.binding) return "skipped";
  const body = JSON.stringify({ id: randomId("evt_"), type: cert.settlement.stripe.event, certificate: cert });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Bloom-Signature": webhookSignature(body, Math.floor(Date.now() / 1000)), "Idempotency-Key": cert.certificateId },
      body,
      signal: AbortSignal.timeout(4000),
    });
    return res.ok ? "dispatched" : "failed";
  } catch {
    return "failed";
  }
}
