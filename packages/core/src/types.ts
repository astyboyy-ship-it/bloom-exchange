import { z } from "zod";

/**
 * Wire and domain types for Bloom Exchange. Client-safe: no server imports, so the command surface and the
 * tests share them. Prices are the total contract value in USD.
 */

export const SLA_TIERS = ["bronze", "silver", "gold", "platinum"] as const;
export type SlaTier = (typeof SLA_TIERS)[number];
export const SlaTierSchema = z.enum(SLA_TIERS);
export const slaRank = (t: SlaTier) => SLA_TIERS.indexOf(t);

const usd = z.number().finite().positive().max(1_000_000_000);

export const effectiveFloor = (m: { floorPriceUsd: number; minMarginPct: number; costBasisUsd: number }): number =>
  Math.max(m.floorPriceUsd, m.minMarginPct >= 100 ? Infinity : m.costBasisUsd / (1 - m.minMarginPct / 100));
export const effectiveCeiling = (m: { ceilingPriceUsd: number; maxBudgetUsd: number }): number => Math.min(m.ceilingPriceUsd, m.maxBudgetUsd);

/**
 * Universal resource dimensions an enclave can clear alongside price: compute, energy, capital, compliance
 * attestations and bandwidth. A provider offers a capacity and a unit floor per dimension; a client requests a
 * quantity (and the least it will accept). Sovereign allocates deterministically before any offer is made.
 */
export const RESOURCE_DIMENSIONS = ["computeUnits", "energyKwh", "capitalUsd", "complianceToken", "bandwidthGbps"] as const;
export type ResourceDimension = (typeof RESOURCE_DIMENSIONS)[number];
export const RESOURCE_UNITS: Record<ResourceDimension, string> = { computeUnits: "CU", energyKwh: "kWh", capitalUsd: "USD", complianceToken: "tokens", bandwidthGbps: "Gbps" };

const quantity = z.number().finite().positive().max(1_000_000_000_000);
const ResourceOffer = z.object({ capacity: quantity, floorUnitPriceUsd: z.number().finite().min(0).max(1_000_000) }).strict();
const ResourceRequest = z
  .object({ quantity, minQuantity: quantity.optional() })
  .strict()
  .refine((r) => r.minQuantity === undefined || r.minQuantity <= r.quantity, { message: "minQuantity must not exceed quantity" });
const dims = <T extends z.ZodType>(s: T) => z.partialRecord(z.enum(RESOURCE_DIMENSIONS), s);
export type ResourceOffers = Partial<Record<ResourceDimension, z.infer<typeof ResourceOffer>>>;
export type ResourceRequests = Partial<Record<ResourceDimension, z.infer<typeof ResourceRequest>>>;
export type Allocation = Partial<Record<ResourceDimension, number>>;

/** The provider's private limits. The lowest acceptable price is the higher of the floor, the margin floor and the resource floor. */
export const InitiatorMandateSchema = z
  .object({
    floorPriceUsd: usd,
    minMarginPct: z.number().finite().min(0).max(95),
    costBasisUsd: z.number().finite().min(0).max(1_000_000_000),
    anchorPriceUsd: usd,
    maxNetDays: z.number().int().min(0).max(180),
    maxSlaTier: SlaTierSchema,
    autoSettleCeilingUsd: usd,
    resources: dims(ResourceOffer).optional(),
  })
  .strict()
  .refine((m) => m.anchorPriceUsd >= effectiveFloor(m) * 1.03, { message: "anchorPriceUsd must sit at least 3% above the effective floor" });
export type InitiatorMandate = z.infer<typeof InitiatorMandateSchema>;

/** The client's private limits. The highest acceptable price is the lower of the ceiling and the budget. */
export const CounterpartyMandateSchema = z
  .object({
    ceilingPriceUsd: usd,
    maxBudgetUsd: usd,
    requiredSlaTier: SlaTierSchema,
    targetNetDays: z.number().int().min(0).max(180),
    openingPriceUsd: usd.optional(),
    resources: dims(ResourceRequest).optional(),
  })
  .strict()
  .refine((m) => m.openingPriceUsd === undefined || m.openingPriceUsd < effectiveCeiling(m), { message: "openingPriceUsd must be below the effective ceiling" });
export type CounterpartyMandate = z.infer<typeof CounterpartyMandateSchema>;

export const ItemSchema = z
  .object({
    description: z.string().trim().min(2).max(200),
    sku: z.string().trim().max(64).optional(),
    quantity: z.number().int().min(1).max(1_000_000).default(1),
  })
  .strict();
export type Item = z.infer<typeof ItemSchema>;

export type Side = "initiator" | "counterparty";
export type Terms = { priceUsd: number; netDays: number; slaTier: SlaTier };

/** One offer as both parties see it. The hash covers exactly these fields, so either side can recompute the chain. */
export type PublicRound = { n: number; by: Side; terms: Terms; message: string; at: string; prevHash: string; hash: string };

export type Engine = "shield" | "cortex" | "aether" | "sovereign" | "apex";

export type ThreatVector =
  | "instruction_override"
  | "role_hijack"
  | "system_prompt_extraction"
  | "mandate_extraction"
  | "jailbreak"
  | "exfiltration"
  | "credential_material"
  | "role_token_smuggling"
  | "invisible_unicode"
  | "encoded_payload"
  | "hidden_markup"
  | "tool_call_smuggling"
  | "card_skill_poisoning"
  | "homoglyph_spoofing"
  | "token_exhaustion"
  | "policy_override_loop";
export type Severity = "low" | "medium" | "high" | "critical";
export type Threat = { vector: ThreatVector; severity: Severity; rule: string; field: string; excerpt: string };
export type FirewallVerdict = "clean" | "neutralized" | "quarantined";

export type TaskState = "submitted" | "working" | "input_required" | "completed" | "failed" | "canceled";
export const TERMINAL: TaskState[] = ["completed", "failed", "canceled"];

export type Environment = "production" | "sandbox" | "stress-test";
export type Source = "live" | "simulated";
export type ExceptionKind = "out_of_bounds" | "above_auto_settle" | "sla_infeasible" | "resource_bounds";
export type PeerFramework = "openai" | "anthropic" | "langgraph" | "webhook" | "bloom-sdk" | "custom";
export type PaymentRail = "stripe" | "x402";

/**
 * Telemetry. `audience: "public"` events reach the external agent; "operator" events carry the provider's own
 * reasoning (clamps, margin proofs) and only reach the provider's command surface. Neither carries the other
 * party's limits.
 */
export type ExchangeEvent = { at: string; audience: "public" | "operator" } & (
  | { type: "enclave.provisioned"; taskId: string; environment: Environment; source: Source; peer: string }
  | { type: "firewall.scan"; verdict: FirewallVerdict; threats: { vector: ThreatVector; severity: Severity; field: string }[] }
  | { type: "engine.signal"; engine: Engine; text: string }
  | { type: "round"; round: PublicRound }
  | { type: "clamp"; engine: "sovereign"; round: number; reasons: string[] }
  | { type: "state"; state: TaskState; reason?: string }
  | { type: "exception"; kind: ExceptionKind }
  | { type: "settled"; certificateId: string; priceUsd: number }
);
/** An event before it is timestamped (Omit distributed over the union, so each variant keeps its own fields). */
export type ExchangeEventInput = ExchangeEvent extends infer E ? (E extends ExchangeEvent ? Omit<E, "at"> : never) : never;

export type Clamp = { rule: "mandate_floor" | "anchor_cap" | "regression" | "concession_rate" | "net_terms" | "sla_tier" | "dominated" | "invalid"; from: number | string; to: number | string };

/** What the provider's operator sees for each of its own offers: the plan, what Apex proposed, what Sovereign kept. */
export type OperatorRoundDetail = { n: number; plan: Terms; proposal: Terms | null; clamps: Clamp[]; model: string; beta: number };

export type CortexSignal = { kind: "extreme_anchor" | "lowball" | "bluff" | "stall" | "hoarding"; round: number; detail: string };

/**
 * Sovereign's verdict on one resource dimension. Public: what was requested and granted, and a salted commitment to
 * the provider's unit floor for that dimension (provable later without revealing it now).
 */
export type ResourceProof = { dimension: ResourceDimension; unit: string; requested: number; granted: number; compliance: "within_mandate" | "clamped_to_capacity"; floorCommitment: string };

export type AetherProof = {
  priceUsd: number;
  costBasisUsd: number;
  realizedMarginPct: number;
  minMarginPct: number;
  marginHeadroomPct: number;
  netDays: number;
  costOfCapitalPct: number;
  timeValueCostUsd: number;
  pvAdjustedMarginPct: number;
  restructures: { round: number; fromNetDays: number; toNetDays: number }[];
  /** The floor the allocated resources impose (Σ granted × unit floor), and how far the price clears it. */
  resourceFloorUsd: number;
  resourceHeadroomUsd: number;
};

export type Compliance = "within_mandate" | "executive_override" | "violation";

export type SettlementCertificate = {
  certificateId: string;
  version: "bloom-xch/1.0";
  issuedAt: string;
  issuer: { name: string; agentCard: string; kid: string };
  environment: Environment;
  source: Source;
  taskId: string;
  contextId: string;
  parties: {
    initiator: { role: "provider"; agent: string; mandateCommitment: string };
    counterparty: { role: "client"; agent: string; framework: PeerFramework; mandateCommitment: string };
  };
  item: Item;
  terms: Terms & { currency: "USD"; paymentDueDate: string };
  compliance: { initiator: Compliance; counterparty: Compliance; verifiedBy: string };
  rounds: { count: number; chainHead: string; chain: PublicRound[] };
  /** Present when the enclave cleared resource dimensions: the allocation and one proof per dimension. */
  resources: { allocation: Allocation; proofs: ResourceProof[] } | null;
  security: { trustScore: number; verdict: FirewallVerdict; threatsNeutralized: number };
  ap2: { checkoutMandate: VerifiableCredential; paymentMandate: VerifiableCredential };
  settlement: { preferredRail: PaymentRail; binding: boolean; stripe: StripeSettlement; x402: X402Requirements };
  digest: string;
  signature: { alg: "EdDSA"; kid: string; value: string };
  seal: { alg: "HMAC-SHA256"; value: string };
};

export type VerifiableCredential = {
  "@context": string[];
  type: string[];
  id: string;
  issuer: string;
  validFrom: string;
  credentialSubject: Record<string, unknown>;
  proof: { type: "DataIntegrityProof"; cryptosuite: "bloom-eddsa-jcs-v1"; verificationMethod: string; proofPurpose: "assertionMethod"; created: string; proofValue: string };
};

export type StripeSettlement = {
  trigger: "webhook";
  event: "bloom.exchange.settlement.minted";
  paymentIntent: { amount: number; currency: "usd"; capture_method: "automatic"; description: string; metadata: Record<string, string> };
  idempotencyKey: string;
};

/** x402 PaymentRequirements for USDC settlement. `payTo` is null until the deployment configures a wallet. */
export type X402Requirements = {
  x402Version: 1;
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  asset: string;
  payTo: string | null;
  resource: string;
  description: string;
  mimeType: "application/json";
  maxTimeoutSeconds: number;
  extra: { name: "USD Coin"; version: "2" };
};

/** The provider's full view of one enclave. Never sent to the external agent. Contains no counterparty limits. */
export type OperatorView = {
  taskId: string;
  contextId: string;
  createdAt: string;
  updatedAt: string;
  state: TaskState;
  statusReason: string | null;
  environment: Environment;
  source: Source;
  peer: { name: string; framework: PeerFramework };
  item: Item;
  initiatorMandate: InitiatorMandate;
  rounds: PublicRound[];
  operatorRounds: OperatorRoundDetail[];
  security: { trust: number; posture: "standard" | "guarded" | "restricted"; verdict: FirewallVerdict; threats: Threat[] };
  signals: CortexSignal[];
  aether: AetherProof | null;
  resources: { allocation: Allocation; proofs: ResourceProof[] } | null;
  exception: { kind: ExceptionKind; detail: string; counterTerms: Terms | null } | null;
  agreedTerms: Terms | null;
  certificate: SettlementCertificate | null;
  decision: { action: "override" | "reject"; by: string; at: string } | null;
  events: ExchangeEvent[];
};

export const DEFAULT_STANDING_MANDATE: InitiatorMandate = {
  floorPriceUsd: 41_370,
  minMarginPct: 28,
  costBasisUsd: 29_400,
  anchorPriceUsd: 58_900,
  maxNetDays: 45,
  maxSlaTier: "gold",
  autoSettleCeilingUsd: 75_000,
  resources: {
    computeUnits: { capacity: 120_000, floorUnitPriceUsd: 0.18 },
    energyKwh: { capacity: 40_000, floorUnitPriceUsd: 0.07 },
    bandwidthGbps: { capacity: 40, floorUnitPriceUsd: 95 },
    complianceToken: { capacity: 12, floorUnitPriceUsd: 250 },
  },
};
