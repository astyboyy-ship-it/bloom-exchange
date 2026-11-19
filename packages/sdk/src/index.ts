export { BloomExchangeClient, BloomExchangeError, type ClientOptions, type NegotiateOptions, type NegotiationResult, type NegotiationRun } from "./client.ts";
export { verifyAgentCard, verifyCertificate, cardKeys, sha256Hex } from "./verify.ts";
export { canonicalize } from "./canonical.ts";
export { sseJson } from "./sse.ts";
export type * from "./types.ts";

// Phase 2: the clearing relay (non-custodial). Keys, signing and clamping live on the edge.
export { AgentKey, verifyEd25519, PUBKEY, SIGNATURE } from "./agent-key.ts";
export { AUTH_HEADERS, AUTH_QUERY, MAX_CLOCK_DRIFT_MS, NONCE_TTL_SECONDS, UUID_V4, EMPTY_BODY_SHA256, authString, signableTarget, signRequest, authHeaders, signedSocketUrl, type SignedAuth } from "./relay-auth.ts";
export { commitMandate, commitmentOf, withinMandate, clampPrice, type Mandate, type MandateOpening } from "./mandate.ts";
export { merkleLeaf, merkleRoot, inclusionProof, verifyInclusion } from "./merkle.ts";
export {
  GENESIS_HASH,
  TERMINAL,
  RECEIPT_VERSION,
  eventHash,
  verifyTranscript,
  receiptDraft,
  receiptFromTranscript,
  offerPrice,
  receiptHash,
  receiptSigningInput,
  signReceipt,
  verifyReceiptSignature,
  verifyRelayReceipt,
  type Party,
  type Room,
  type RoomEvent,
  type RoomEventType,
  type RoomStatus,
  type RelayReceipt,
  type ReceiptPayload,
  type ReceiptVerification,
  type ReceiptCheck,
} from "./relay-protocol.ts";
export { RelayTransport, RelayError, DEFAULT_RELAY_URL, type RelayTransportOptions, type Intent, type IntentFilter, type Reputation, type RoomEventInput, type SubscribeMode, type Subscription } from "./relay-transport.ts";
export { toB64url, fromB64url, toHex, fromHex, sha256HexOf, randomHex } from "./bytes.ts";
