export type SlaTier = "bronze" | "silver" | "gold" | "platinum";

/** Macro resource dimensions an enclave can clear alongside price. */
export type ResourceDimension = "computeUnits" | "energyKwh" | "capitalUsd" | "complianceToken" | "bandwidthGbps";
/** What you want per dimension: `quantity`, and the least you will accept (`minQuantity`, defaults to `quantity`). */
export type ResourceRequest = { quantity: number; minQuantity?: number };
export type Allocation = Partial<Record<ResourceDimension, number>>;
/** Sovereign's public verdict on one dimension, with a salted commitment to the provider's private unit floor. */
export type ResourceProof = { dimension: ResourceDimension; unit: string; requested: number; granted: number; compliance: "within_mandate" | "clamped_to_capacity"; floorCommitment: string };

/** Your private limits as the buying agent. Sealed in the clearinghouse vault; never shown to the provider. */
export type BuyerMandate = {
  ceilingPriceUsd: number;
  maxBudgetUsd: number;
  requiredSlaTier: SlaTier;
  targetNetDays: number;
  /** Optional first offer. Defaults to 70% of your reserve. */
  openingPriceUsd?: number;
  /** Resource dimensions to clear alongside price. Granted min(quantity, provider capacity); below minQuantity escalates. */
  resources?: Partial<Record<ResourceDimension, ResourceRequest>>;
};

export type Item = { description: string; sku?: string; quantity?: number };
export type Terms = { priceUsd: number; netDays: number; slaTier: SlaTier };
export type TaskState = "submitted" | "working" | "input_required" | "completed" | "failed" | "canceled";
export type Round = { n: number; by: "initiator" | "counterparty"; terms: Terms; message: string; at: string; prevHash: string; hash: string };

export type Jwk = { kty: "OKP"; crv: "Ed25519"; x: string; kid: string; alg?: string; use?: string };

export type AgentCard = {
  name: string;
  description: string;
  version: string;
  supportedInterfaces: { url: string; protocolBinding: string; protocolVersion: string }[];
  capabilities: { streaming?: boolean; extensions?: { uri: string; params?: Record<string, unknown> }[] };
  skills: { id: string; name: string; description: string }[];
  signatures?: { protected: string; signature: string }[];
  [k: string]: unknown;
};

export type Credential = {
  "@context": string[];
  type: string[];
  id: string;
  issuer: string;
  validFrom: string;
  credentialSubject: Record<string, unknown>;
  proof: { type: string; cryptosuite: string; verificationMethod: string; proofPurpose: string; created: string; proofValue: string };
};

/** A BLOOM-XCH settlement certificate. Typed loosely enough to verify any version-1.0 certificate. */
export type SettlementCertificate = {
  certificateId: string;
  version: string;
  issuedAt: string;
  issuer: { name: string; agentCard: string; kid: string };
  environment: "production" | "sandbox" | "stress-test";
  source: "live" | "simulated";
  taskId: string;
  contextId: string;
  terms: Terms & { currency: "USD"; paymentDueDate: string };
  compliance: { initiator: string; counterparty: string; verifiedBy: string };
  rounds: { count: number; chainHead: string; chain: Round[] };
  /** Present when resource dimensions were cleared. Covered by the digest and signature like every other field. */
  resources: { allocation: Allocation; proofs: ResourceProof[] } | null;
  ap2: { checkoutMandate: Credential; paymentMandate: Credential };
  settlement: { preferredRail: "stripe" | "x402"; binding: boolean; stripe: Record<string, unknown>; x402: Record<string, unknown> };
  digest: string;
  signature: { alg: "EdDSA"; kid: string; value: string };
  seal: { alg: string; value: string };
  [k: string]: unknown;
};

export type A2ATask = {
  kind: "task";
  id: string;
  contextId: string;
  status: { state: TaskState; timestamp: string; message?: { parts: { kind: string; text?: string }[] } };
  history: unknown[];
  artifacts: { artifactId: string; name: string; parts: { kind: string; data?: unknown }[] }[];
  metadata: Record<string, unknown>;
};

export type ExchangeStreamEvent =
  | { type: "task"; task: A2ATask }
  | { type: "round"; round: Round }
  | { type: "firewall"; verdict: "clean" | "neutralized" | "quarantined"; threats: { vector: string; severity: string; field: string }[] }
  | { type: "state"; state: TaskState; reason?: string }
  | { type: "settled"; certificate: SettlementCertificate }
  | { type: "signal"; engine: string; text: string }
  | { type: "final"; state: TaskState };

export type VerificationResult = {
  valid: boolean;
  checks: { digest: boolean; certificateId: boolean; chain: boolean; signature: boolean; ap2Proofs: boolean };
  reason?: string;
};
