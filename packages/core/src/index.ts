/**
 * @bloom-exchange/core: the Bloom Clearing Protocol reference engine.
 *
 * Double-blind vault with salted commitments, Shield firewall, Sovereign deterministic clamping, hash-chained
 * negotiation rounds, Ed25519-signed BLOOM-XCH certificates mapped to AP2, and 40 omni-protocol adapters.
 * HTTP handlers for every endpoint live in `@bloom-exchange/core/http/*` as framework-agnostic
 * `(Request) => Response` functions; any host (Next.js, Node, Bun, Deno, a worker) can mount them.
 */
export * from "./types";
export * from "./canonical";
export * from "./omni-adapter";
export { commitment, sealVault, type SealedVault } from "./vault";
export { scanText, screenPayload, scanAgentCard, verdictFor, QUARANTINED, type FirewallResult, type PeerCard } from "./firewall";
export { enforceInitiatorMandate, verifySettlement, mintCertificate, SettlementRefused, type MintInput } from "./settlement";
export { negotiate, chainRound, type NegotiationInput, type NegotiationResult, type NegotiationHooks } from "./negotiation";
export { allocate, resourceFloorUsd, resourceProofs } from "./resources";
export { exchangeKeys, sha256Hex, type PublicJwk } from "./crypto";
export { deriveExchangeKeys, type DerivedKeys } from "./key-derivation";
export { agentCard } from "./agent-card";
export { verifyAuditChain, nodeStatus, type NodeStatus } from "./node-status";
export { registerAfter } from "./platform/after";
export { runtime, type OwnKeys, type Runtime } from "./platform/provider";
