# Bloom Clearing Protocol v0.1

**Status:** draft for implementation and review · **Editors:** Bloom Exchange maintainers · **Reference implementation:** `packages/core` · **Client and verifier:** `packages/sdk`

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as described in RFC 2119.

## 1. Purpose and scope

The Bloom Clearing Protocol (BCP) lets two autonomous agents negotiate terms without disclosing their private limits to each other, and settle with a receipt that any third party can verify offline. It is defined as an **extension profile of A2A v1.0** and maps its settlement output to **AP2** mandates and to **Stripe** or **x402** payment payloads. It does not replace any of those protocols; it adds what they leave open:

1. **Sealed mandates:** each party's private limits are deposited once and bound by a salted commitment.
2. **Deterministic enforcement:** no offer outside either sealed mandate is ever sent or signed, whatever a model proposes.
3. **Verifiable settlement:** a hash-chained record of every round, signed with Ed25519, checkable with public information only.

Out of scope for v0.1: multi-party (more than two) clearing, cross-node federation (see §12), and payment execution itself (BCP emits the instruction; the rail settles it).

## 2. Roles and terms

| Term | Meaning |
|---|---|
| **Node** | A server implementing this specification. It publishes an Agent Card and runs enclaves. |
| **Initiator** | The party whose standing mandate the node holds: the provider (seller). |
| **Counterparty** | The external agent that opens a negotiation: the client (buyer). |
| **Mandate** | A party's private limits (price bounds, payment terms, SLA, resource quantities). |
| **Enclave** | One negotiation: a task with its sealed vault, rounds and outcome. |
| **Vault** | The per-enclave store of both mandates, their salts and guard bands. |
| **Certificate** | The signed BLOOM-XCH settlement record. Also called the receipt. |

## 3. Discovery: the Agent Card extension

A node MUST serve an A2A v1.0 Agent Card at `/.well-known/agent-card.json`. The card MUST declare the settlement extension:

```json
{
  "uri": "https://bloom.ai/a2a/ext/settlement/v1",
  "required": false,
  "params": {
    "jwks": { "keys": [{ "kty": "OKP", "crv": "Ed25519", "x": "<base64url>", "kid": "bxk-<16 hex>", "alg": "EdDSA", "use": "sig" }] },
    "certificateVersion": "bloom-xch/1.0",
    "rails": ["stripe", "x402"],
    "resourceDimensions": [{ "id": "computeUnits", "unit": "CU" }]
  }
}
```

The card MUST be signed as a **detached JWS** (`alg: "EdDSA"`, `kid` matching a key in `params.jwks`) over the canonical JSON (§5) of the card with its `signatures` member removed: `signature = Ed25519(base64url(header) + "." + base64url(canonical(card)))`. Clients MUST verify the card signature against the card's own published key before trusting any key in it, and SHOULD pin the key for the session. A card that fails verification MUST NOT be used to verify certificates.

**Key identifiers.** `kid = "bxk-" + hex(SHA-256(x))[0:16]` where `x` is the base64url public key. Nodes SHOULD publish the full SHA-256 fingerprint out of band for key ceremonies.

## 4. Transport

A node MUST implement the A2A v1.0 JSON-RPC binding at the URL listed in the card's `supportedInterfaces` and SHOULD implement the HTTP+JSON binding.

| JSON-RPC method (v1.0) | v0.3 alias | HTTP+JSON | Semantics |
|---|---|---|---|
| `SendMessage` | `message/send` | `POST /v1/message:send` | Open (or resume) an enclave; returns the task. |
| `SendStreamingMessage` | `message/stream` | `POST /v1/message:stream` | As above, streaming events over SSE. |
| `GetTask` | `tasks/get` | `GET /v1/tasks/{id}` | Current task state and history. |
| `CancelTask` | `tasks/cancel` | `POST /v1/tasks/{id}:cancel` | Cancel a non-terminal task. |
| `SubscribeToTask` | `tasks/resubscribe` | `GET /v1/tasks/{id}:subscribe` | Re-attach to a task's event stream. |
| `GetExtendedAgentCard` | `agent/getAuthenticatedExtendedCard` | — | The card as seen by an authenticated caller. |

**Idempotency.** `SendMessage`/`SendStreamingMessage` MUST accept an `Idempotency-Key` header. A retry with the same key and the same payload MUST replay the original outcome (`Idempotency-Replayed: true`) and MUST NOT open a second enclave or mint a second certificate. The same key with a different payload MUST fail with `-32050`.

**Errors.** JSON-RPC errors use these codes in addition to the JSON-RPC 2.0 standard ones:

| Code | HTTP | Meaning |
|---|---|---|
| `-32001` | 404 | Task not found. |
| `-32002` | 409 | Task cannot be canceled. |
| `-32004` | 400 | Unsupported operation. |
| `-32029` | 429 | Rate limit reached. |
| `-32050` | 422 | Idempotency-Key reused with a different payload. |
| `-32051` | 409 | Request with this Idempotency-Key still provisioning; retry. |
| `-32052` | 409 | Task not resumable. |

Limits: request bodies MUST NOT exceed 64 KiB; JSON-RPC batches hold 1 to 20 requests.

## 5. Canonical JSON

Every hash and signature in BCP covers **canonical JSON**: object members sorted by key in code-unit order, no insignificant whitespace, members whose value is `undefined` omitted, `undefined` array elements encoded as `null`, numbers as produced by ECMAScript `JSON.stringify`, non-finite numbers rejected. This is the RFC 8785 (JCS) form for the value space BCP uses (integers and decimal amounts within IEEE-754 safe range). Implementations in other languages MUST match the reference byte for byte; §11 provides vectors.

`SHA-256` outputs are lowercase hexadecimal unless stated otherwise.

## 6. Negotiation request

The counterparty opens an enclave with an A2A message whose parts include free text (optional) and one data part:

```json
{ "kind": "data", "data": { "bloomExchange": {
  "intent": "negotiate",
  "mandate": { "ceilingPriceUsd": 52500, "maxBudgetUsd": 55000, "requiredSlaTier": "gold", "targetNetDays": 60, "openingPriceUsd": 38000,
               "resources": { "computeUnits": { "quantity": 90000, "minQuantity": 60000 } } },
  "item": { "description": "12-month platform license", "quantity": 1 },
  "paymentRail": "stripe",
  "peer": { "name": "northwind-procurement", "framework": "langgraph" }
} } }
```

**Counterparty mandate.** `ceilingPriceUsd`, `maxBudgetUsd`, `requiredSlaTier ∈ {bronze, silver, gold, platinum}`, `targetNetDays ∈ [0, 180]`, optional `openingPriceUsd` (MUST be below the effective ceiling, `min(ceilingPriceUsd, maxBudgetUsd)`), optional per-dimension resource requests. Unknown members MUST be rejected.

**Initiator mandate** (held by the node, never transmitted): `anchorPriceUsd` (list price), `floorPriceUsd`, `costBasisUsd`, `minMarginPct`, `maxNetDays`, `maxSlaTier`, `autoSettleCeilingUsd`, optional per-dimension `capacity` and `floorUnitPriceUsd`. The **effective floor** is `max(floorPriceUsd, costBasisUsd ÷ (1 − minMarginPct/100))`, raised further by allocated resources (§8).

Free text and any peer Agent Card MUST pass the firewall (§10) before any engine reads them.

## 7. The sealed vault

On opening, the node MUST create a vault holding both mandates, one fresh random salt per party, and one guard band per party:

* **Commitments.** `commitment(m, salt) = SHA-256(canonical({ "mandate": m, "salt": salt }))`. Both commitments are printed on the certificate. A party MAY later open its commitment by revealing `m` and `salt`; anyone can recompute it.
* **Guard bands.** Each party's working reserve sits a seeded fraction inside its limit: initiator reserve `= ceil(floor × (1 + g_i) / 10) × 10` with `g_i ∈ [0.006, 0.024)`; counterparty reserve `= floor(ceiling × (1 − g_c) / 10) × 10` with `g_c ∈ [0.015, 0.045)`. No offer therefore lands exactly on a private number.
* **Side-specific access.** The initiator's negotiating engines (and any model prompt they build) MUST receive only the initiator brief: anchor, initiator reserve, maximum net days, maximum SLA, auto-settle ceiling. No counterparty value may reach them by construction. The counterparty's proxy receives only the counterparty's own policy.
* **Leak scrubbing.** No message, event or response sent to the counterparty may contain the initiator's floor, cost basis, margin or reserve. Implementations MUST scrub outbound text against the sealed values.

## 8. Rounds and deterministic enforcement

Negotiation is alternating offers. Each round is

```
Round = { n, by ∈ {"initiator","counterparty"}, terms: { priceUsd, netDays, slaTier }, message, at (RFC 3339), prevHash, hash }
hash  = SHA-256(canonical({ n, by, terms, message, at, prevHash }))
prevHash of round 1 = GENESIS = "0" × 64
```

Before any initiator offer is sent, the node MUST clamp it ("Sovereign") so that:

1. `priceUsd ≥ max(effective floor, allocated resource floor) + guard band`;
2. offers never rise after a concession and never exceed `anchorPriceUsd`;
3. a single concession is at most 35% of the anchor-to-reserve gap, shrinking with counterparty trust;
4. the price is never below a price the counterparty has already offered;
5. `netDays ≤ maxNetDays` and `slaTier ≤ maxSlaTier`.

**Resources.** For each requested dimension the node grants `min(quantity, capacity)`; a grant below `minQuantity`, or a dimension the initiator does not offer, is a bounds exception. Allocated resources set a price floor `Σ granted × floorUnitPriceUsd`, and the certificate carries one proof per dimension with a salted commitment to the unit floor.

A model MAY propose offers; the clamp is authoritative. An implementation MUST be able to demonstrate (as the reference does with randomized enclaves) that no out-of-bounds offer is ever sent or signed, whatever the proposer returns.

**Outcomes.** Agreement inside both mandates and below `autoSettleCeilingUsd` settles (`completed`). Terms outside either mandate, above the auto-settle ceiling, an infeasible SLA or a resource-bounds violation end in `input_required` with an exception kind (`out_of_bounds`, `above_auto_settle`, `sla_infeasible`, `resource_bounds`) for the initiator's owner to override (mint) or reject. A counterparty MAY resume an `input_required` task with a revised mandate.

## 9. The BLOOM-XCH certificate

Minted only when the final terms verify against **both** sealed mandates (or by an explicit owner override, recorded as such).

```
Certificate = {
  certificateId, version: "bloom-xch/1.0", issuedAt,
  issuer: { name, agentCard: <URL of the issuer's Agent Card>, kid },
  environment ∈ {production, sandbox, stress-test}, source ∈ {live, simulated},
  taskId, contextId,
  parties: { initiator: { role: "provider", agent, mandateCommitment },
             counterparty: { role: "client", agent, framework, mandateCommitment } },
  item, terms: { priceUsd, netDays, slaTier, currency: "USD", paymentDueDate },
  compliance, rounds: { count, chainHead, chain: Round[] },
  resources: { allocation, proofs[] } | null,
  security: { trustScore, verdict, threatsNeutralized },
  ap2: { checkoutMandate: VC, paymentMandate: VC },
  settlement: { preferredRail, binding, stripe, x402 },
  digest, signature: { alg: "EdDSA", kid, value }, seal: { alg: "HMAC-SHA256", value }
}
```

* `chainHead` is the `hash` of the last round.
* `certificateId = "BLOOM-XCH-" + groups of 4 of Crockford-base32(first 10 bytes of SHA-256("BLOOM-XCH|" + taskId + "|" + chainHead + "|" + issuedAt))`.
* `digest = SHA-256(canonical(certificate without digest, signature and seal))`.
* `signature.value = base64url(Ed25519(signingInput))` with `signingInput = "BLOOM-XCH-SIG-v1\n" + digest`.
* `seal` is an HMAC-SHA256 over the same signing input under the node's private seal key. It lets the node detect tampering with records it stores; third parties cannot verify it and MUST NOT rely on it.
* **AP2 credentials.** `checkoutMandate` and `paymentMandate` are W3C Verifiable Credentials with a `DataIntegrityProof`, `cryptosuite: "bloom-eddsa-jcs-v1"`, `verificationMethod: "<issuer>#<kid>"`, and `proofValue = base64url(Ed25519(canonical(credential with proof minus proofValue)))`.
* `settlement.binding` is `false` for sandbox and stress-test environments. Verifiers MUST surface it.

## 10. Firewall (Shield)

Every external field (free text, peer Agent Card, intent payloads) MUST be screened before any engine reads it, at least for: prompt-injection instructions, role or policy override attempts, invisible and tag-smuggled Unicode, homoglyph obfuscation, base64-wrapped payloads, hidden markup and token-exhaustion padding. Critical findings MUST quarantine the text so that only structured terms proceed. Each interception is appended to a hash-chained audit ledger, which an operator can re-verify end to end: `hash = SHA-256(JSON.stringify({ at, taskId, peer, verdict, vectors, prevHash }))` with members in exactly that order and `prevHash` of the first entry `"0" × 64`. (The ledger is node-internal and predates §5; v0.2 will move it to canonical JSON.)

## 11. Verification algorithm

Given a certificate `C` and an Agent Card `A`, a verifier MUST:

1. Verify `A`'s detached JWS against a key in `A`'s settlement extension (§3). Fail if it does not verify.
2. Recompute `digest` (§9) and compare with `C.digest`.
3. Walk `C.rounds.chain`: each `prevHash` equals the previous round's `hash` (the first equals `GENESIS` or the stated first `prevHash`), each `hash` recomputes (§8), the count matches `C.rounds.count`, and the last `hash` equals `C.rounds.chainHead`.
4. Recompute `certificateId` (§9) and compare.
5. Verify `C.signature` with the key in `A` whose `kid` equals `C.signature.kid`.
6. Verify both AP2 credential proofs with the key named in their `verificationMethod`.

The certificate is **valid** only if every step passes. Verification needs no network access when `A` is supplied; otherwise `A` is fetched from `C.issuer.agentCard`. The reference verifier is `verifyCertificate()` in `@bloom-exchange/sdk` and the `bloom-verify` CLI.

**Conformance.** The test suites in `packages/core/test` (end-to-end settlement, leakage, settlement safety under 300 randomized enclaves, firewall, resources, omni-protocol, sovereign node) and `packages/sdk/test` (verification and tampering) are the v0.1 conformance vectors. An independent implementation SHOULD reproduce their outcomes against its own node and verify certificates minted by the reference node, and vice versa.

## 12. Security considerations and threat model

| Threat | Mitigation in v0.1 | Residual risk |
|---|---|---|
| Counterparty probes or injects to extract the initiator's floor | Side-specific vault accessors; firewall; outbound leak scrubber; guard bands | Statistical inference across many enclaves; rate limits and trust scoring reduce it. |
| A model proposes an out-of-bounds offer | Deterministic clamp before send and before mint | None by construction, given a correct implementation. |
| Forged or altered receipt | Digest, round chain, id derivation, Ed25519 signature, AP2 proofs | Key compromise; rotate keys and publish fingerprints out of band. |
| Malicious or impersonated Agent Card | Detached JWS over canonical card; pin keys | Trust on first use; publish fingerprints out of band. |
| Replay or double settlement | Idempotency keys bound to payload | None for honest retries. |
| **The node operator reading the counterparty's mandate** | Commitments make any later dispute auditable | **Open.** In v0.1 the vault runs on the initiator's node, so the counterparty trusts that operator. Neutral hosted clearing, attested enclaves (TEE remote attestation printed on the certificate) and commit-reveal or MPC bound proofs are the roadmap answers. |

**Federation (future).** v0.2 is expected to define node discovery through a signed registry, cross-node receipt verification, and a public transparency log of certificate hashes with signed checkpoints.

## 13. Versioning

This document is BCP v0.1. Certificates declare `version: "bloom-xch/1.0"`; the card extension URI carries `/v1`. Breaking changes to the certificate format or signing input change those identifiers. Additive members MAY appear in later minor versions; verifiers MUST ignore members they do not understand, except that they MUST include them when recomputing the digest.
