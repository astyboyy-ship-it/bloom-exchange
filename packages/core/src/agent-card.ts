import { canonicalize } from "./canonical";
import { exchangeKeys, signString } from "./crypto";
import { RESOURCE_DIMENSIONS, RESOURCE_UNITS } from "./types";

/**
 * The A2A v1.0 Agent Card for Bloom Exchange. Signed as a detached JWS (EdDSA) over the canonical JSON of the
 * card without its `signatures` member; the verifying key is published in the card itself (Bloom settlement
 * extension, `params.jwks`) and identified by `kid`, so the SDK can pin it and verify every certificate offline.
 */
export function agentCard(origin: string) {
  const keys = exchangeKeys();
  const endpoint = `${origin}/api/exchange/a2a`;
  const card = {
    name: "Bloom Exchange",
    description:
      "Autonomous inter-agent clearinghouse. Deposit a sealed mandate, and Bloom negotiates against the provider's standing mandate inside a double-blind enclave, then mints a signed BLOOM-XCH settlement certificate mapped to AP2 checkout and payment mandates.",
    version: "1.0.0",
    provider: { organization: process.env.BLOOM_NODE_ORG?.trim() || "Bloom AI", url: origin },
    documentationUrl: `${origin}/`,
    iconUrl: `${origin}/icon.svg`,
    supportedInterfaces: [
      { url: endpoint, protocolBinding: "JSONRPC", protocolVersion: "1.0" },
      { url: endpoint, protocolBinding: "HTTP+JSON", protocolVersion: "1.0" },
    ],
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: true,
      extensions: [
        {
          uri: "https://bloom.ai/a2a/ext/settlement/v1",
          description: "BLOOM-XCH settlement certificates: Ed25519-signed, round hash-chained, with salted mandate commitments.",
          required: false,
          params: { jwks: { keys: [keys.jwk] }, keyOrigin: keys.origin, certificateVersion: "bloom-xch/1.0", rails: ["stripe", "x402"], resourceDimensions: RESOURCE_DIMENSIONS.map((d) => ({ id: d, unit: RESOURCE_UNITS[d] })) },
        },
        { uri: "https://github.com/google-agentic-commerce/AP2/tree/v0.1", description: "AP2 checkout and payment mandates issued as verifiable credentials on settlement.", required: false, params: { roles: ["merchant"] } },
      ],
    },
    securitySchemes: {
      bloomAccessKey: { type: "http", scheme: "bearer", bearerFormat: "BLOOMK", description: "A Bloom access key negotiates against the provider's live standing mandate. Without one, calls run in a sandbox enclave (deterministic simulation, non-binding)." },
    },
    security: [{ bloomAccessKey: [] }, {}],
    defaultInputModes: ["application/json", "text/plain"],
    defaultOutputModes: ["application/json", "text/event-stream"],
    skills: [
      {
        id: "autonomous-negotiation",
        name: "Autonomous negotiation",
        description: "Multi-round alternating-offers negotiation on price, payment terms and SLA tier, plus deterministic clearing of resource dimensions (computeUnits, energyKwh, capitalUsd, complianceToken, bandwidthGbps), run by the Bloom parliament for the provider and a neutral proxy bound to your mandate.",
        tags: ["negotiation", "procurement", "a2a"],
        examples: ['{"mandate":{"ceilingPriceUsd":52000,"maxBudgetUsd":55000,"requiredSlaTier":"gold","targetNetDays":45},"item":{"description":"12-month platform license"}}', '{"mandate":{"ceilingPriceUsd":64000,"maxBudgetUsd":70000,"requiredSlaTier":"gold","targetNetDays":30,"resources":{"computeUnits":{"quantity":90000},"energyKwh":{"quantity":30000,"minQuantity":20000}}},"item":{"description":"Q1 inference capacity"}}'],
        inputModes: ["application/json"],
        outputModes: ["application/json", "text/event-stream"],
      },
      {
        id: "scope-arbitration",
        name: "Scope arbitration",
        description: "Reconciles SLA tier and payment-term requirements against both sealed mandates, and escalates to the provider's executive when terms fall outside them.",
        tags: ["sla", "terms", "escalation"],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
      {
        id: "mandate-settlement",
        name: "Mandate settlement",
        description: "Verifies final terms against both mandates and mints a BLOOM-XCH certificate with AP2 checkout and payment mandates and Stripe or x402 (USDC) settlement payloads.",
        tags: ["settlement", "ap2", "x402", "stripe"],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
    ],
  };
  const header = { alg: "EdDSA", kid: keys.jwk.kid, typ: "JOSE" };
  const protectedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payload = Buffer.from(canonicalize(card)).toString("base64url");
  return { ...card, signatures: [{ protected: protectedHeader, signature: signString(`${protectedHeader}.${payload}`) }] };
}
