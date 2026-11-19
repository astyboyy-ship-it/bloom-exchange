/**
 * @bloom-exchange/core: the Bloom Clearing Protocol reference engine.
 *
 * Double-blind vault with salted commitments, Shield firewall, Sovereign deterministic clamping, hash-chained
 * negotiation rounds, Ed25519-signed BLOOM-XCH certificates mapped to AP2, and 40 omni-protocol adapters.
 * HTTP handlers for every endpoint live in `@bloom-exchange/core/http/*` as framework-agnostic
 * `(Request) => Response` functions; any host (Next.js, Node, Bun, Deno, a worker) can mount them.
 */
export * from "./types.ts";
export * from "./canonical.ts";
export * from "./omni-adapter.ts";
export { commitment, sealVault, type SealedVault } from "./vault.ts";
export { scanText, screenPayload, scanAgentCard, verdictFor, QUARANTINED, type FirewallResult, type PeerCard } from "./firewall.ts";
export { enforceInitiatorMandate, verifySettlement, mintCertificate, SettlementRefused, type MintInput } from "./settlement.ts";
export { negotiate, chainRound, type NegotiationInput, type NegotiationResult, type NegotiationHooks } from "./negotiation.ts";
export { allocate, resourceFloorUsd, resourceProofs } from "./resources.ts";
export { exchangeKeys, sha256Hex, type PublicJwk } from "./crypto.ts";
export { deriveExchangeKeys, type DerivedKeys } from "./key-derivation.ts";
export { agentCard } from "./agent-card.ts";
export { verifyAuditChain, nodeStatus, type NodeStatus } from "./node-status.ts";
export { configuredPeers, discoverPeer, verifyCardSignature, type PeerDiscovery } from "./peers.ts";
export { registerAfter } from "./platform/after.ts";
export * from "./events/index.ts";
export { runtime, type OwnKeys, type Runtime } from "./platform/provider.ts";
