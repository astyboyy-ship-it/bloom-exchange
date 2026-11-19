# Bloom Clearing Protocol v0.1

**Status:** draft for implementation and review · **Editors:** Bloom Exchange maintainers · **Reference implementation:** `packages/core` · **Client and verifier:** `packages/sdk`

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as described in RFC 2119.

## 1. Purpose and scope

The Bloom Clearing Protocol (BCP) lets two autonomous agents negotiate terms without disclosing their private limits to each other, and settle with a receipt that any third party can verify offline. It is defined as an **extension profile of A2A v1.0** and maps its settlement output to **AP2** mandates and to **Stripe** or **x402** payment payloads. It does not replace any of those protocols; it adds what they leave open:

1. **Sealed mandates:** each party's private limits are deposited once and bound by a salted commitment.
2. **Deterministic enforcement:** no offer outside either sealed mandate is ever sent or signed, whatever a model proposes.
3. **Verifiable settlement:** a hash-chained record of every round, signed with Ed25519, checkable with public information only.

Out of scope for v0.1: multi-party (more than two) clearing, a public node registry and federated settlement across operators (see §13), and payment execution itself (BCP emits the instruction; the rail settles it). Peer discovery between known nodes is in scope (§3.1).

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

**Key identifiers.** `kid = "bxk-" + hex(SHA-256(UTF-8(x)))[0:16]` where `x` is the base64url (unpadded) public key string. Nodes SHOULD publish the full fingerprint (`hex(SHA-256(UTF-8(x)))` uppercased, grouped in fours) out of band for key ceremonies.

**Key derivation (reference implementation; RECOMMENDED).** A node holding a secret `S` derives its Ed25519 seed as `HMAC-SHA256(key = UTF-8(S), message = "bloom-exchange/ed25519/v1")` (32 bytes, the RFC 8032 private key) and its HMAC seal key as `HMAC-SHA256(UTF-8(S), "bloom-exchange/hmac-seal/v1")`. Deterministic derivation lets an operator print the root fingerprint before the node first starts (vector A.2).

**Node names.** A node SHOULD name its card `"Bloom Exchange"` or, when operated under an organization, `"Bloom Exchange · <organization>"`; certificates repeat the same string as `issuer.name`.

### 3.1 Peer discovery

A node MAY be configured with known peers (base URLs). On `GET /api/exchange/peers` it returns its own `{ organization, kid }` and, for each peer, the result of fetching the peer's `/.well-known/agent-card.json` and verifying its detached JWS as above: `{ url, verified, name, organization, kid, endpoint }`. Only public card data is returned. An agent of one node negotiates on another as an ordinary counterparty (§6), presenting its home node's signed card as `peer.agentCard`; the receiving node screens the card (§10) and records its screened `name` as the counterparty on the certificate.

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

Every hash and signature in BCP covers **canonical JSON**, hashed or signed as the **UTF-8 encoding** of that string. The rules are equivalent to RFC 8785 (JCS) for the value space BCP uses:

1. **Objects:** members sorted by key, comparing keys as sequences of **UTF-16 code units** (not UTF-8 bytes; the two orders differ only for keys outside the Basic Multilingual Plane). Members whose value is absent (`undefined`) are omitted. No whitespace anywhere: `{"a":1,"b":2}`.
2. **Arrays:** elements in order, comma-separated; an absent element is written `null`.
3. **Strings:** as ECMAScript `JSON.stringify`: `"` and `\` escaped; U+0008, U+0009, U+000A, U+000C, U+000D as `\b`, `\t`, `\n`, `\f`, `\r`; other code points below U+0020 as `\u00xx` (lowercase hex); lone surrogates as `\uxxxx`; every other character emitted literally (non-ASCII is never `\u`-escaped).
4. **Numbers:** as ECMAScript `Number.prototype.toString` (shortest round-trip form; `-0` is written `0`; exponent form such as `1e+21` from 10²¹). Non-finite numbers MUST be rejected. Amounts in BCP are integers or short decimals well inside the IEEE-754 safe range.
5. **Literals:** `true`, `false`, `null`.

SHA-256 outputs are lowercase hexadecimal. Signatures and keys are base64url **without padding** (RFC 4648 §5). Appendix A gives byte-exact vectors: an implementation that reproduces A.1 to A.6 produces identical digests, ids and signatures.

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

**Member order does not exist on the wire.** Every member is covered through canonical JSON (§5), so producers MAY serialize members in any order and verifiers MUST canonicalize before hashing. The signed bytes are fixed entirely by the rules below.

* `chainHead` is the `hash` of the last round.
* `certificateId = "BLOOM-XCH-" + groups of 4 of Crockford-base32(first 10 bytes of SHA-256("BLOOM-XCH|" + taskId + "|" + chainHead + "|" + issuedAt))`.
* `digest = hex(SHA-256(UTF-8(canonical(C′))))`, where `C′` is the certificate with the `digest`, `signature` and `seal` members removed and every other member (including any a verifier does not understand) kept.
* `signature.value = base64url(Ed25519-Sign(sk, M))`: RFC 8032 pure Ed25519, 64-byte signature, over `M = UTF-8("BLOOM-XCH-SIG-v1" ‖ LF ‖ digest)`: the 16 ASCII bytes of the prefix, one line feed (0x0A), then the 64 ASCII hex characters of the digest, 81 bytes in total.
* `seal` is an HMAC-SHA256 over the same signing input under the node's private seal key. It lets the node detect tampering with records it stores; third parties cannot verify it and MUST NOT rely on it.
* **AP2 credentials.** `checkoutMandate` and `paymentMandate` are W3C Verifiable Credentials with a `DataIntegrityProof`, `cryptosuite: "bloom-eddsa-jcs-v1"`, `verificationMethod: "<issuer>#<kid>"`, and `proofValue = base64url(Ed25519(canonical(credential with proof minus proofValue)))`.
* `settlement.binding` is `false` for sandbox and stress-test environments. Verifiers MUST surface it.

**Chaining.** Within a certificate, rounds are hash-chained (§8) and the chain head is bound into both the id and the digest. **Certificates are not chained to each other in v0.1.** Each receipt is self-contained and independently verifiable, but a node's sequence of receipts is not tamper-evident as a sequence. (The node's firewall audit ledger *is* hash-chained, §10.) Cross-receipt ordering and non-omission are the job of the v0.2 transparency log (§13), which appends each certificate's `digest` to a Merkle log with signed checkpoints, without changing the certificate format.

## 10. Firewall (Shield)

Every external field (free text, peer Agent Card, intent payloads) MUST be screened before any engine reads it, at least for: prompt-injection instructions, role or policy override attempts, invisible and tag-smuggled Unicode, homoglyph obfuscation, base64-wrapped payloads, hidden markup and token-exhaustion padding. Critical findings MUST quarantine the text so that only structured terms proceed. Each interception is appended to a hash-chained audit ledger, which an operator can re-verify end to end: `hash = SHA-256(JSON.stringify({ at, taskId, peer, verdict, vectors, prevHash }))` with members in exactly that order and `prevHash` of the first entry `"0" × 64`. (The ledger is node-internal and predates §5; v0.2 will move it to canonical JSON.)

## 11. Verification algorithm

Given a certificate `C` and an Agent Card `A`, a verifier MUST:

1. **Card.** Decode `A.signatures[0].protected` (base64url → JSON); require `alg = "EdDSA"`; take the key with that `kid` from `A`'s settlement extension; verify the signature over `UTF-8(protected ‖ "." ‖ base64url(UTF-8(canonical(A without "signatures"))))`. Fail if it does not verify.
2. **Digest.** Remove `digest`, `signature` and `seal` from `C`; canonicalize; SHA-256 the UTF-8 bytes; compare the lowercase hex with `C.digest`.
3. **Round chain.** Walk `C.rounds.chain` in order. For round *i*: `prevHash_i` equals `hash_{i−1}` (`prevHash_1` is the chain's stated first `prevHash`, `GENESIS` for a fresh enclave), and `hash_i = hex(SHA-256(UTF-8(canonical({ n, by, terms, message, at, prevHash }))))` over exactly those six members. Require the length to equal `C.rounds.count` and the last hash to equal `C.rounds.chainHead`.
4. **Id.** `h = SHA-256(UTF-8("BLOOM-XCH|" ‖ taskId ‖ "|" ‖ chainHead ‖ "|" ‖ issuedAt))`. Take the first 10 bytes; encode them as Crockford base32 (alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, most significant bit first, 80 bits → 16 symbols); format `BLOOM-XCH-XXXX-XXXX-XXXX-XXXX`; compare with `C.certificateId`.
5. **Signature.** Require `C.signature.alg = "EdDSA"`; take the key in `A` whose `kid` equals `C.signature.kid`; verify the 64 bytes of `base64url-decode(C.signature.value)` over `M = UTF-8("BLOOM-XCH-SIG-v1\n" ‖ C.digest)` with RFC 8032 Ed25519.
6. **AP2 proofs.** For each credential: take the `kid` after `#` in `proof.verificationMethod`; remove `proofValue` from `proof`; verify `proofValue` with Ed25519 over `UTF-8(canonical(credential with that reduced proof))`.

The certificate is **valid** only if every step passes. Verification needs no network access when `A` is supplied; otherwise `A` is fetched from `C.issuer.agentCard`. The reference verifier is `verifyCertificate()` in `@bloom-exchange/sdk` and the `bloom-verify` CLI.

**Conformance.** Appendix A gives byte-exact vectors for every primitive; Appendix B maps every test in the reference suite to a conformance id. An independent implementation SHOULD reproduce Appendix A exactly, reproduce the normative Appendix B outcomes against its own node, and verify certificates minted by the reference node, and vice versa.

## 12. Security considerations and threat model

### 12.1 Security boundaries

**Protected today, by construction or by cryptography:**

* The counterparty never sees the provider's sealed limits, and the provider's engines and their model prompts never see the counterparty's, in any response, stream, event or prompt (vault accessors, leak scrubber; BCP-VAULT-*).
* No offer outside either sealed mandate is sent or signed, whatever a model proposes (clamp; BCP-CLAMP-*).
* A certificate cannot be altered without detection, and it verifies only against its issuer's key (digest, round chain, id, Ed25519, AP2 proofs; BCP-VERIFY-*, BCP-VEC-*).
* Hostile text is neutralized before any engine reads it (BCP-SHIELD-*), and retries never double-settle (BCP-SETTLE-*).

**Not protected in v0.1 (needs a neutral operator or a TEE):**

* **The operator of the clearing node can read both mandates**, because the vault runs in that node's memory and storage. A counterparty therefore trusts the provider's operator.
* A dishonest operator can refuse to settle, or can mint a receipt that misstates the counterparty's mandate. The counterparty can detect the misstatement afterwards by opening its own commitment, but cannot prevent it.
* Receipts are not chained to each other (§9), so an operator can omit or reorder its own history.

**Roadmap answers:** neutral hosted clearing, where neither party operates the vault; attested enclaves, with TEE remote-attestation evidence for the exact clearing code printed on the certificate; a public transparency log of certificate digests; and commit-reveal, MPC or zero-knowledge range proofs, so that "a price fits inside both sealed bounds" holds with no trusted party.

### 12.2 Threats

| Threat | Mitigation in v0.1 | Residual risk |
|---|---|---|
| Counterparty probes or injects to extract the initiator's floor | Side-specific vault accessors; firewall; outbound leak scrubber; guard bands | Statistical inference across many enclaves; rate limits and trust scoring reduce it. |
| A model proposes an out-of-bounds offer | Deterministic clamp before send and before mint | None by construction, given a correct implementation. |
| Forged or altered receipt | Digest, round chain, id derivation, Ed25519 signature, AP2 proofs | Key compromise; rotate keys and publish fingerprints out of band. |
| Malicious or impersonated Agent Card | Detached JWS over canonical card; pin keys | Trust on first use; publish fingerprints out of band. |
| Replay or double settlement | Idempotency keys bound to payload | None for honest retries. |
| **The node operator reading the counterparty's mandate** | Commitments make any later dispute auditable | **Open.** In v0.1 the vault runs on the initiator's node, so the counterparty trusts that operator. Neutral hosted clearing, attested enclaves (TEE remote attestation printed on the certificate) and commit-reveal or MPC bound proofs are the roadmap answers. |

## 13. Roadmap (non-normative)

v0.2 is expected to define a signed node registry (beyond §3.1's configured peers), federated settlement across operators, and a public transparency log of certificate digests with signed checkpoints.

## 14. Versioning

This document is BCP v0.1. Certificates declare `version: "bloom-xch/1.0"`; the card extension URI carries `/v1`. Breaking changes to the certificate format or signing input change those identifiers. Additive members MAY appear in later minor versions; verifiers MUST ignore members they do not understand, except that they MUST include them when recomputing the digest.

## Appendix A. Test vectors

All values come from the reference implementation and are locked by `packages/core/test/vectors.test.ts` (conformance BCP-VEC-01 to BCP-VEC-06). Hash inputs are the UTF-8 bytes of the strings shown.

**A.1 Canonical JSON.** Input (an ECMAScript value) `{ b: 2, a: [3, "x", null, true], "é": "ü", c: { z: 1.5, y: -0 }, u: undefined }` gives

```
{"a":[3,"x",null,true],"b":2,"c":{"y":0,"z":1.5},"é":"ü"}
```

**A.2 Key derivation.** `S = "bcp-v0.1-test-vector-secret"`

| Value | |
|---|---|
| seed = HMAC-SHA256(S, "bloom-exchange/ed25519/v1") | `15062cf58c0f23fb66a6ced537f7e86fe4df968e14410f48398ab58f7a0d8ade` |
| public key `x` (base64url) | `E1nxv_r2gElknFSUy4fX-XDQ7pwTYAIHdPmEghrwYPs` |
| `kid` | `bxk-ec9ef1d17dc2ace6` |
| fingerprint | `EC9E:F1D1:7DC2:ACE6:0776:52FC:0F32:0E2A:0793:6A59:0A06:3DB6:2335:827F:8725:16F3` |

**A.3 Round hash.** The round `{ n: 1, by: "initiator", terms: { priceUsd: 58900, netDays: 30, slaTier: "gold" }, message: "Opening at list.", at: "2026-01-01T00:00:00.000Z", prevHash: GENESIS }` canonicalizes to

```
{"at":"2026-01-01T00:00:00.000Z","by":"initiator","message":"Opening at list.","n":1,"prevHash":"0000000000000000000000000000000000000000000000000000000000000000","terms":{"netDays":30,"priceUsd":58900,"slaTier":"gold"}}
```

and hashes to `760938828bf49ff168aa8d1547c9935c1caf5240997eeb94f91beed45a6bd5ce`.

**A.4 Mandate commitment.** `mandate = { ceilingPriceUsd: 52500, maxBudgetUsd: 55000, requiredSlaTier: "gold", targetNetDays: 60 }`, `salt = "00112233445566778899aabbccddeeff"`. Input

```
{"mandate":{"ceilingPriceUsd":52500,"maxBudgetUsd":55000,"requiredSlaTier":"gold","targetNetDays":60},"salt":"00112233445566778899aabbccddeeff"}
```

Commitment `7e761878ea8d05cefeddbc9720e0e4f9728543d5697be7efbf5aef1f33e5ec82`.

**A.5 Certificate id.** `taskId = "xch_vector000000001"`, `chainHead` = the A.3 hash, `issuedAt = "2026-01-01T00:05:00.000Z"`. Input `BLOOM-XCH|xch_vector000000001|760938828bf49ff168aa8d1547c9935c1caf5240997eeb94f91beed45a6bd5ce|2026-01-01T00:05:00.000Z`, SHA-256 `dc4ab153cf8cb6492bc7409b3ad481303c14987cff6980ab0dc39448a3139306`, id **`BLOOM-XCH-VH5B-2MYF-HJV4-JAY7`**.

**A.6 Signature.** With the A.2 key: `digest = SHA-256(canonical({ hello: "bloom" })) = 3928ce786b2f56ae2e570fc3f76aae906c33d520181b13de97ab2f282454dd25`; `M = "BLOOM-XCH-SIG-v1\n" + digest` (81 bytes). Ed25519 is deterministic (RFC 8032), so every conforming signer produces

```
p5Py8nbNiYWfEYcwbpinLMg0ReJ5iqn8p53MRrp8TE0M4qGL9haRrGxQhR6ocgxgLqiTevnLTOeU_4qtXF6VDQ
```

## Appendix B. Conformance vectors

Every test in the reference suite, with a stable id. `VEC`, `SETTLE`, `CLAMP`, `VAULT`, `SHIELD`, `RES`, `OMNI`, `NODE`, `PEER`, `HTTP` and `VERIFY` are normative for v0.1. `MCP` and `DESK` cover the reference tooling and are non-normative.

<!-- BEGIN CONFORMANCE (generated by npm run spec:conformance; do not edit by hand) -->
193 vectors, 193 passing at generation time.

| ID | Spec | Vector | Suite | Status |
|---|---|---|---|---|
| BCP-VEC-01 | §5, §9, App. A | BCP v0.1 test vectors (SPEC Appendix A) › A.1 canonical JSON: sorted keys by UTF-16 code unit, no whitespace, undefined dropped, -0 as 0 | `vectors.test.ts` | pass |
| BCP-VEC-02 | §5, §9, App. A | BCP v0.1 test vectors (SPEC Appendix A) › A.2 key derivation: seed = HMAC-SHA256(secret, 'bloom-exchange/ed25519/v1'), kid = 'bxk-' + SHA-256(x)[0:16] | `vectors.test.ts` | pass |
| BCP-VEC-03 | §5, §9, App. A | BCP v0.1 test vectors (SPEC Appendix A) › A.3 round hash over the canonical round with prevHash = GENESIS | `vectors.test.ts` | pass |
| BCP-VEC-04 | §5, §9, App. A | BCP v0.1 test vectors (SPEC Appendix A) › A.4 mandate commitment = SHA-256(canonical({ mandate, salt })) | `vectors.test.ts` | pass |
| BCP-VEC-05 | §5, §9, App. A | BCP v0.1 test vectors (SPEC Appendix A) › A.5 certificate id from taskId, chain head and issuedAt | `vectors.test.ts` | pass |
| BCP-VEC-06 | §5, §9, App. A | BCP v0.1 test vectors (SPEC Appendix A) › A.6 Ed25519 over 'BLOOM-XCH-SIG-v1\n' + digest (UTF-8), base64url without padding | `vectors.test.ts` | pass |
| BCP-SETTLE-01 | §4, §6, §9, §11 | end-to-end autonomous settlement › publishes a signed A2A v1.0 agent card | `e2e-settlement.test.ts` | pass |
| BCP-SETTLE-02 | §4, §6, §9, §11 | end-to-end autonomous settlement › settles a JSON-RPC SendMessage autonomously and mints a verifiable BLOOM-XCH + AP2 certificate | `e2e-settlement.test.ts` | pass |
| BCP-SETTLE-03 | §4, §6, §9, §11 | end-to-end autonomous settlement › streams the lifecycle over SSE: task, rounds, settlement artifact, final status | `e2e-settlement.test.ts` | pass |
| BCP-SETTLE-04 | §4, §6, §9, §11 | end-to-end autonomous settlement › answers the same Idempotency-Key with the same task, and never settles twice | `e2e-settlement.test.ts` | pass |
| BCP-SETTLE-05 | §4, §6, §9, §11 | end-to-end autonomous settlement › escalates an out-of-bounds counter, then settles on executive override with the override on the certificate | `e2e-settlement.test.ts` | pass |
| BCP-SETTLE-06 | §4, §6, §9, §11 | end-to-end autonomous settlement › resumes an escalated task on a revised mandate, continuing the same hash chain | `e2e-settlement.test.ts` | pass |
| BCP-SETTLE-07 | §4, §6, §9, §11 | end-to-end autonomous settlement › serves the same negotiation over the HTTP+JSON binding | `e2e-settlement.test.ts` | pass |
| BCP-SETTLE-08 | §4, §6, §9, §11 | end-to-end autonomous settlement › rejects malformed JSON-RPC and unknown methods with spec error codes | `e2e-settlement.test.ts` | pass |
| BCP-CLAMP-01 | §8 | deterministic mathematical safety › clamps a below-floor concession to the reserve | `settlement-safety.test.ts` | pass |
| BCP-CLAMP-02 | §8 | deterministic mathematical safety › caps the concession rate, forbids regressions and the anchor, and clamps terms and SLA | `settlement-safety.test.ts` | pass |
| BCP-CLAMP-03 | §8 | deterministic mathematical safety › rejects non-numeric proposals outright | `settlement-safety.test.ts` | pass |
| BCP-CLAMP-04 | §8 | deterministic mathematical safety › refuses to mint a certificate outside either mandate | `settlement-safety.test.ts` | pass |
| BCP-CLAMP-05 | §8 | deterministic mathematical safety › never sends or settles an out-of-bounds offer, however the model behaves (300 randomized enclaves) | `settlement-safety.test.ts` | pass |
| BCP-CLAMP-06 | §8 | deterministic mathematical safety › never offers less than the client has already put on the table | `settlement-safety.test.ts` | pass |
| BCP-CLAMP-07 | §8 | deterministic mathematical safety › routes a counterparty that pushes past the standing bounds to the exception queue | `settlement-safety.test.ts` | pass |
| BCP-VAULT-01 | §7 | zero mandate leakage › never puts the provider's private figures in a JSON-RPC response | `leakage.test.ts` | pass |
| BCP-VAULT-02 | §7 | zero mandate leakage › never puts them in a streamed response either, round by round | `leakage.test.ts` | pass |
| BCP-VAULT-03 | §7 | zero mandate leakage › keeps operator telemetry out of an external stream even when asked for it | `leakage.test.ts` | pass |
| BCP-VAULT-04 | §7 | zero mandate leakage › gives the provider's operator view no counterparty limits | `leakage.test.ts` | pass |
| BCP-VAULT-05 | §7 | zero mandate leakage › builds every Apex prompt from the provider's side only | `leakage.test.ts` | pass |
| BCP-VAULT-06 | §7 | zero mandate leakage › redacts a model that tries to disclose the floor, cost basis or margin | `leakage.test.ts` | pass |
| BCP-VAULT-07 | §7 | zero mandate leakage › scrubs rounded spellings but never the offer being made | `leakage.test.ts` | pass |
| BCP-VAULT-08 | §7 | zero mandate leakage › never lets an offer land exactly on a private limit | `leakage.test.ts` | pass |
| BCP-SHIELD-01 | §10 | context-poisoning and prompt-injection firewall › neutralizes instruction_override | `firewall.test.ts` | pass |
| BCP-SHIELD-02 | §10 | context-poisoning and prompt-injection firewall › neutralizes instruction_override | `firewall.test.ts` | pass |
| BCP-SHIELD-03 | §10 | context-poisoning and prompt-injection firewall › neutralizes instruction_override | `firewall.test.ts` | pass |
| BCP-SHIELD-04 | §10 | context-poisoning and prompt-injection firewall › neutralizes role_hijack | `firewall.test.ts` | pass |
| BCP-SHIELD-05 | §10 | context-poisoning and prompt-injection firewall › neutralizes role_hijack | `firewall.test.ts` | pass |
| BCP-SHIELD-06 | §10 | context-poisoning and prompt-injection firewall › neutralizes system_prompt_extraction | `firewall.test.ts` | pass |
| BCP-SHIELD-07 | §10 | context-poisoning and prompt-injection firewall › neutralizes mandate_extraction | `firewall.test.ts` | pass |
| BCP-SHIELD-08 | §10 | context-poisoning and prompt-injection firewall › neutralizes mandate_extraction | `firewall.test.ts` | pass |
| BCP-SHIELD-09 | §10 | context-poisoning and prompt-injection firewall › neutralizes jailbreak | `firewall.test.ts` | pass |
| BCP-SHIELD-10 | §10 | context-poisoning and prompt-injection firewall › neutralizes exfiltration | `firewall.test.ts` | pass |
| BCP-SHIELD-11 | §10 | context-poisoning and prompt-injection firewall › neutralizes credential_material | `firewall.test.ts` | pass |
| BCP-SHIELD-12 | §10 | context-poisoning and prompt-injection firewall › neutralizes role_token_smuggling | `firewall.test.ts` | pass |
| BCP-SHIELD-13 | §10 | context-poisoning and prompt-injection firewall › neutralizes tool_call_smuggling | `firewall.test.ts` | pass |
| BCP-SHIELD-14 | §10 | context-poisoning and prompt-injection firewall › decodes and removes hidden channels: zero-width, Unicode tags, HTML comments, base64 | `firewall.test.ts` | pass |
| BCP-SHIELD-15 | §10 | context-poisoning and prompt-injection firewall › folds homoglyph-spoofed instructions back to Latin and neutralizes them | `firewall.test.ts` | pass |
| BCP-SHIELD-16 | §10 | context-poisoning and prompt-injection firewall › neutralizes token-exhaustion floods: repetition loops and oversized payloads | `firewall.test.ts` | pass |
| BCP-SHIELD-17 | §10 | context-poisoning and prompt-injection firewall › escalates a policy-override loop to critical, quarantining the payload | `firewall.test.ts` | pass |
| BCP-SHIELD-18 | §10 | context-poisoning and prompt-injection firewall › stays fast on adversarial input at the size limit | `firewall.test.ts` | pass |
| BCP-SHIELD-19 | §10 | context-poisoning and prompt-injection firewall › leaves ordinary business language untouched | `firewall.test.ts` | pass |
| BCP-SHIELD-20 | §10 | context-poisoning and prompt-injection firewall › quarantines a payload with a critical finding, keeping only structured terms | `firewall.test.ts` | pass |
| BCP-SHIELD-21 | §10 | context-poisoning and prompt-injection firewall › catches poisoned Agent Card skill descriptions | `firewall.test.ts` | pass |
| BCP-SHIELD-22 | §10 | context-poisoning and prompt-injection firewall › never lets injected text reach an engine, and logs every blocked vector | `firewall.test.ts` | pass |
| BCP-SHIELD-23 | §10 | context-poisoning and prompt-injection firewall › reports the verdict to the external agent through the A2A gateway | `firewall.test.ts` | pass |
| BCP-RES-01 | §8 | universal resource clearing › allocates deterministically: clamps to capacity, honours minimums, rejects what isn't offered | `resources.test.ts` | pass |
| BCP-RES-02 | §8 | universal resource clearing › raises the provider's floor to the allocated resources' floor | `resources.test.ts` | pass |
| BCP-RES-03 | §8 | universal resource clearing › settles price and resources together, with per-dimension proofs that verify offline | `resources.test.ts` | pass |
| BCP-RES-04 | §8 | universal resource clearing › flags hoarding when a swarm requests far beyond capacity | `resources.test.ts` | pass |
| BCP-RES-05 | §8 | universal resource clearing › sends a capacity breach to the exception queue and can't be overridden into a settlement | `resources.test.ts` | pass |
| BCP-RES-06 | §8 | universal resource clearing › never discloses a unit floor or capacity limit to the external agent | `resources.test.ts` | pass |
| BCP-OMNI-01 | §6, §10 | omni-protocol normalization › covers all six macro-domains with at least forty protocol adapters | `omni.test.ts` | pass |
| BCP-OMNI-02 | §6, §10 | omni-protocol normalization › normalizes a real-shaped whatsapp payload | `omni.test.ts` | pass |
| BCP-OMNI-03 | §6, §10 | omni-protocol normalization › normalizes a real-shaped telegram payload | `omni.test.ts` | pass |
| BCP-OMNI-04 | §6, §10 | omni-protocol normalization › normalizes a real-shaped discord payload | `omni.test.ts` | pass |
| BCP-OMNI-05 | §6, §10 | omni-protocol normalization › normalizes a real-shaped slack payload | `omni.test.ts` | pass |
| BCP-OMNI-06 | §6, §10 | omni-protocol normalization › normalizes a real-shaped x payload | `omni.test.ts` | pass |
| BCP-OMNI-07 | §6, §10 | omni-protocol normalization › normalizes a real-shaped email payload | `omni.test.ts` | pass |
| BCP-OMNI-08 | §6, §10 | omni-protocol normalization › normalizes a real-shaped instagram payload | `omni.test.ts` | pass |
| BCP-OMNI-09 | §6, §10 | omni-protocol normalization › normalizes a real-shaped linkedin payload | `omni.test.ts` | pass |
| BCP-OMNI-10 | §6, §10 | omni-protocol normalization › normalizes a real-shaped voice_sms payload | `omni.test.ts` | pass |
| BCP-OMNI-11 | §6, §10 | omni-protocol normalization › normalizes a real-shaped salesforce payload | `omni.test.ts` | pass |
| BCP-OMNI-12 | §6, §10 | omni-protocol normalization › normalizes a real-shaped hubspot payload | `omni.test.ts` | pass |
| BCP-OMNI-13 | §6, §10 | omni-protocol normalization › normalizes a real-shaped shopify payload | `omni.test.ts` | pass |
| BCP-OMNI-14 | §6, §10 | omni-protocol normalization › normalizes a real-shaped stripe payload | `omni.test.ts` | pass |
| BCP-OMNI-15 | §6, §10 | omni-protocol normalization › normalizes a real-shaped sap payload | `omni.test.ts` | pass |
| BCP-OMNI-16 | §6, §10 | omni-protocol normalization › normalizes a real-shaped linear payload | `omni.test.ts` | pass |
| BCP-OMNI-17 | §6, §10 | omni-protocol normalization › normalizes a real-shaped notion payload | `omni.test.ts` | pass |
| BCP-OMNI-18 | §6, §10 | omni-protocol normalization › normalizes a real-shaped erp payload | `omni.test.ts` | pass |
| BCP-OMNI-19 | §6, §10 | omni-protocol normalization › normalizes a real-shaped a2a payload | `omni.test.ts` | pass |
| BCP-OMNI-20 | §6, §10 | omni-protocol normalization › normalizes a real-shaped mcp payload | `omni.test.ts` | pass |
| BCP-OMNI-21 | §6, §10 | omni-protocol normalization › normalizes a real-shaped langgraph payload | `omni.test.ts` | pass |
| BCP-OMNI-22 | §6, §10 | omni-protocol normalization › normalizes a real-shaped crewai payload | `omni.test.ts` | pass |
| BCP-OMNI-23 | §6, §10 | omni-protocol normalization › normalizes a real-shaped autogen payload | `omni.test.ts` | pass |
| BCP-OMNI-24 | §6, §10 | omni-protocol normalization › normalizes a real-shaped aws_spot payload | `omni.test.ts` | pass |
| BCP-OMNI-25 | §6, §10 | omni-protocol normalization › normalizes a real-shaped gcp payload | `omni.test.ts` | pass |
| BCP-OMNI-26 | §6, §10 | omni-protocol normalization › normalizes a real-shaped azure payload | `omni.test.ts` | pass |
| BCP-OMNI-27 | §6, §10 | omni-protocol normalization › normalizes a real-shaped gpu_cluster payload | `omni.test.ts` | pass |
| BCP-OMNI-28 | §6, §10 | omni-protocol normalization › normalizes a real-shaped kubernetes payload | `omni.test.ts` | pass |
| BCP-OMNI-29 | §6, §10 | omni-protocol normalization › normalizes a real-shaped microgrid payload | `omni.test.ts` | pass |
| BCP-OMNI-30 | §6, §10 | omni-protocol normalization › normalizes a real-shaped iot payload | `omni.test.ts` | pass |
| BCP-OMNI-31 | §6, §10 | omni-protocol normalization › normalizes a real-shaped x402 payload | `omni.test.ts` | pass |
| BCP-OMNI-32 | §6, §10 | omni-protocol normalization › normalizes a real-shaped ethereum payload | `omni.test.ts` | pass |
| BCP-OMNI-33 | §6, §10 | omni-protocol normalization › normalizes a real-shaped solana payload | `omni.test.ts` | pass |
| BCP-OMNI-34 | §6, §10 | omni-protocol normalization › normalizes a real-shaped base payload | `omni.test.ts` | pass |
| BCP-OMNI-35 | §6, §10 | omni-protocol normalization › normalizes a real-shaped swift_iso20022 payload | `omni.test.ts` | pass |
| BCP-OMNI-36 | §6, §10 | omni-protocol normalization › normalizes a real-shaped treasury payload | `omni.test.ts` | pass |
| BCP-OMNI-37 | §6, §10 | omni-protocol normalization › normalizes a real-shaped rest payload | `omni.test.ts` | pass |
| BCP-OMNI-38 | §6, §10 | omni-protocol normalization › normalizes a real-shaped graphql payload | `omni.test.ts` | pass |
| BCP-OMNI-39 | §6, §10 | omni-protocol normalization › normalizes a real-shaped grpc payload | `omni.test.ts` | pass |
| BCP-OMNI-40 | §6, §10 | omni-protocol normalization › normalizes a real-shaped websocket payload | `omni.test.ts` | pass |
| BCP-OMNI-41 | §6, §10 | omni-protocol normalization › normalizes a real-shaped custom_schema payload | `omni.test.ts` | pass |
| BCP-OMNI-42 | §6, §10 | omni-protocol normalization › extracts exact quantities from text and structured fields | `omni.test.ts` | pass |
| BCP-OMNI-43 | §6, §10 | omni-protocol normalization › accepts any custom protocol by name, and payloads of any shape | `omni.test.ts` | pass |
| BCP-OMNI-44 | §6, §10 | omni-protocol clearing pipeline › clears every one of the forty adapters end to end through the real enclave | `omni.test.ts` | pass |
| BCP-OMNI-45 | §6, §10 | omni-protocol clearing pipeline › settles into a certificate that verifies offline | `omni.test.ts` | pass |
| BCP-OMNI-46 | §6, §10 | omni-protocol clearing pipeline › clamps an oversized request to capacity and holds an under-funded one at the bound | `omni.test.ts` | pass |
| BCP-OMNI-47 | §6, §10 | omni-protocol clearing pipeline › quarantines a hostile payload before it reaches the vault | `omni.test.ts` | pass |
| BCP-OMNI-48 | §6, §10 | omni-protocol clearing pipeline › scopes intents to the caller who injected them | `omni.test.ts` | pass |
| BCP-OMNI-49 | §6, §10 | omni-protocol clearing pipeline › publishes a pulse of aggregates only: no goals, agent names or custom protocol names | `omni.test.ts` | pass |
| BCP-OMNI-50 | §6, §10 | omni-protocol clearing pipeline › aggregates a window correctly | `omni.test.ts` | pass |
| BCP-NODE-01 | §3, §10 | sovereign private node › derives the same root key in the initializer and on the server | `sovereign.test.ts` | pass |
| BCP-NODE-02 | §3, §10 | sovereign private node › tells anyone the mode and fingerprint, but hides hardware and audit without an operator key | `sovereign.test.ts` | pass |
| BCP-NODE-03 | §3, §10 | sovereign private node › reports the air-gap posture from real configuration | `sovereign.test.ts` | pass |
| BCP-NODE-04 | §3, §10 | sovereign private node › shows the operator host hardware and a re-verified audit chain | `sovereign.test.ts` | pass |
| BCP-PEER-01 | §3 | peer discovery › verifies a node's signed Agent Card with node:crypto alone | `peers.test.ts` | pass |
| BCP-PEER-02 | §3 | peer discovery › rejects a card altered after signing | `peers.test.ts` | pass |
| BCP-PEER-03 | §3 | peer discovery › parses BLOOM_PEERS and discovers each peer's verified identity and endpoint | `peers.test.ts` | pass |
| BCP-PEER-04 | §3 | peer discovery › serves the node's own identity and its peers at /api/exchange/peers | `peers.test.ts` | pass |
| BCP-HTTP-01 | §4 | framework-agnostic router › serves the signed Agent Card and status at the same paths as a Next.js node | `router.test.ts` | pass |
| BCP-HTTP-02 | §4 | framework-agnostic router › answers 405 with Allow for a wrong method and 404 for unknown paths | `router.test.ts` | pass |
| BCP-ORIGIN-01 | §3, §12 (non-normative) | public URL guardrails › warns once per production process when the public URL is derived, and never otherwise | `public-url.test.ts` | pass |
| BCP-ORIGIN-02 | §3, §12 (non-normative) | public URL guardrails › reports on /api/exchange/node whether the public URL is configured or derived from Host | `public-url.test.ts` | pass |
| BCP-ORIGIN-03 | §3, §12 (non-normative) | public URL guardrails › strict mode refuses binding negotiations while the URL is derived, without burning the idempotency key | `public-url.test.ts` | pass |
| BCP-ORIGIN-04 | §3, §12 (non-normative) | public URL guardrails › strict mode leaves sandbox and demo flows alone | `public-url.test.ts` | pass |
| BCP-ORIGIN-05 | §3, §12 (non-normative) | public URL guardrails › is off by default: binding negotiations clear with a derived URL, as before | `public-url.test.ts` | pass |
| BCP-VERIFY-01 | §11 | bloom-verify › verifies a genuine receipt offline against a saved Agent Card (exit 0) | `cli.test.ts` | pass |
| BCP-VERIFY-02 | §11 | bloom-verify › fetches the issuer's Agent Card when no --card is given | `cli.test.ts` | pass |
| BCP-VERIFY-03 | §11 | bloom-verify › accepts a leading `verify` subcommand (npx @bloom-exchange/sdk verify …) | `cli.test.ts` | pass |
| BCP-VERIFY-04 | §11 | bloom-verify › finds the certificate inside an enclave export | `cli.test.ts` | pass |
| BCP-VERIFY-05 | §11 | bloom-verify › rejects a receipt whose settled price was altered (exit 1) | `cli.test.ts` | pass |
| BCP-VERIFY-06 | §11 | bloom-verify › rejects keys from a tampered Agent Card even when the receipt is intact | `cli.test.ts` | pass |
| BCP-VERIFY-07 | §11 | bloom-verify › reports usage and unreadable input with exit 2 | `cli.test.ts` | pass |
| BCP-BUILD-01 | non-normative | SDK sources › run under Node's type stripping (scripts import them directly) | `strip-types.test.ts` | pass |
| BCP-MCP-01 | §11 (non-normative) | Bloom Exchange MCP server › exposes negotiate, verify_receipt, publish_intent and poll_events with input schemas | `mcp.test.ts` | pass |
| BCP-MCP-02 | §11 (non-normative) | Bloom Exchange MCP server › negotiates to a settlement and returns a receipt that already verified | `mcp.test.ts` | pass |
| BCP-MCP-03 | §11 (non-normative) | Bloom Exchange MCP server › holds at the mandate bound when no price fits both sealed limits | `mcp.test.ts` | pass |
| BCP-MCP-04 | §11 (non-normative) | Bloom Exchange MCP server › publishes an intent through the Omni-Bridge and Shield | `mcp.test.ts` | pass |
| BCP-EVT-01 | §7 (non-normative event feed) | Bloom events: redaction › never carries a mandate figure, margin, salt or free text, in the feed or in any adapter's output | `events.test.ts` | pass |
| BCP-EVT-02 | §7 (non-normative event feed) | Bloom events: redaction › projects clamps as rule names only, and exceptions as their kind only | `events.test.ts` | pass |
| BCP-EVT-03 | §7 (non-normative event feed) | Bloom events: redaction › emits the lifecycle in order and references the signed receipt | `events.test.ts` | pass |
| BCP-EVT-04 | §7 (non-normative event feed) | Bloom events: cursors › pages through the log in order, without gaps or duplicates | `events.test.ts` | pass |
| BCP-EVT-05 | §7 (non-normative event feed) | Bloom events: cursors › advances the cursor past events a type filter skips | `events.test.ts` | pass |
| BCP-EVT-06 | §7 (non-normative event feed) | Bloom events: cursors › reports reset for a cursor from before a restart, from the future, or off the retained window | `events.test.ts` | pass |
| BCP-EVT-07 | §7 (non-normative event feed) | Bloom events: cursors › keeps cursors valid across restarts with the durable file log | `events.test.ts` | pass |
| BCP-EVT-08 | §7 (non-normative event feed) | Bloom events: cursors › stamps every event with the node's signing key id, so two nodes' events never look alike | `events.test.ts` | pass |
| BCP-EVT-09 | §7 (non-normative event feed) | Bloom events: cursors › derives stable, distinct event ids | `events.test.ts` | pass |
| BCP-EVT-10 | §7 (non-normative event feed) | Bloom events: adapters, idempotency and retries › retries a retryable failure with backoff and delivers once | `events.test.ts` | pass |
| BCP-EVT-11 | §7 (non-normative event feed) | Bloom events: adapters, idempotency and retries › delivers an event at most once per adapter, even dispatched twice or concurrently | `events.test.ts` | pass |
| BCP-EVT-12 | §7 (non-normative event feed) | Bloom events: adapters, idempotency and retries › stops at a non-retryable failure and dead-letters exhausted deliveries | `events.test.ts` | pass |
| BCP-EVT-13 | §7 (non-normative event feed) | Bloom events: adapters, idempotency and retries › delivers to each adapter in log order, one at a time, and sheds load past its queue bound | `events.test.ts` | pass |
| BCP-EVT-14 | §7 (non-normative event feed) | Bloom events: adapters, idempotency and retries › only sends an adapter the event types it asked for | `events.test.ts` | pass |
| BCP-EVT-15 | §7 (non-normative event feed) | Bloom events: adapters, idempotency and retries › never lets a failing adapter or subscriber affect the negotiation | `events.test.ts` | pass |
| BCP-EVT-16 | §7 (non-normative event feed) | Bloom events: adapters, idempotency and retries › logs nothing and runs nothing while events are off | `events.test.ts` | pass |
| BCP-EVT-17 | §7 (non-normative event feed) | Bloom events: HTTP feed › shows a caller nothing it does not own, and the operator everything plus adapter status | `events.test.ts` | pass |
| BCP-EVT-18 | §7 (non-normative event feed) | Bloom events: HTTP feed › pages by cursor, filters by type and rejects unknown types without echoing them | `events.test.ts` | pass |
| BCP-EVT-19 | §7 (non-normative event feed) | Bloom events: HTTP feed › reports a misconfigured adapter instead of dropping it silently | `events.test.ts` | pass |
| BCP-EVT-20 | §7 (non-normative event feed) | Bloom events: HTTP feed › streams over SSE: replays from the cursor, then pushes live events with resumable ids | `events.test.ts` | pass |
| BCP-EVTSCOPE-01 | §7, §12 (non-normative event feed) | Bloom events: who sees what › never lets one anonymous caller enumerate another's sandbox tasks (and from there its operator stream) | `events-scope.test.ts` | pass |
| BCP-EVTSCOPE-02 | §7, §12 (non-normative event feed) | Bloom events: who sees what › gives a key holder its own tasks, and never a production counterparty the operator-side events | `events-scope.test.ts` | pass |
| BCP-EVTSCOPE-03 | §7, §12 (non-normative event feed) | Bloom events: who sees what › narrows to presented task ids for every reader; ids never widen and never union with owned tasks | `events-scope.test.ts` | pass |
| BCP-EVTSCOPE-04 | §7, §12 (non-normative event feed) | Bloom events: who sees what › gives feed reads their own budget, so polling never starves the same caller's negotiations | `events-scope.test.ts` | pass |
| BCP-EVTSCOPE-05 | §7, §12 (non-normative event feed) | Bloom events: who sees what › shows a sandbox task's operator-side events to whoever holds its id, as the A2A sandbox stream does | `events-scope.test.ts` | pass |
| BCP-HOOK-01 | non-normative | SSRF guard › classifies private, reserved and public addresses | `events-webhook.test.ts` | pass |
| BCP-HOOK-02 | non-normative | SSRF guard › enforces https, an exact-origin allowlist and no credentials | `events-webhook.test.ts` | pass |
| BCP-HOOK-03 | non-normative | SSRF guard › refuses a public name that resolves, or rebinds, to a private address | `events-webhook.test.ts` | pass |
| BCP-HOOK-04 | non-normative | Webhook adapter › refuses a bad configuration up front | `events-webhook.test.ts` | pass |
| BCP-HOOK-05 | non-normative | Webhook adapter › POSTs the event signed, with its id as the idempotency key | `events-webhook.test.ts` | pass |
| BCP-HOOK-06 | non-normative | Webhook adapter › handles the response by status only: a hostile body is never read | `events-webhook.test.ts` | pass |
| BCP-HOOK-07 | non-normative | Webhook adapter › never follows a redirect | `events-webhook.test.ts` | pass |
| BCP-HOOK-08 | non-normative | Webhook adapter › times out a receiver that never answers | `events-webhook.test.ts` | pass |
| BCP-HOOK-09 | non-normative | Webhook adapter › caps the timeout at 4 seconds whatever is configured | `events-webhook.test.ts` | pass |
| BCP-HOOK-10 | non-normative | Webhook adapter › blocks a DNS-rebinding target before connecting, and treats it as non-retryable | `events-webhook.test.ts` | pass |
| BCP-HOOK-11 | non-normative | Webhook adapter › counts DNS against the same deadline: a resolver that hangs cannot stretch an attempt | `events-webhook.test.ts` | pass |
| BCP-HOOK-12 | non-normative | Webhook adapter › checks without sending anything (dry run) | `events-webhook.test.ts` | pass |
| BCP-HOOK-13 | non-normative | Webhook adapter › retries a 5xx through the registry, then dead-letters it | `events-webhook.test.ts` | pass |
| BCP-MCPEVT-01 | non-normative | MCP event tools › filters on exactly the event types the node defines | `events.test.ts` | pass |
| BCP-MCPEVT-02 | non-normative | MCP event tools › lists poll_events and the subscribable bloom://events resource | `events.test.ts` | pass |
| BCP-MCPEVT-03 | non-normative | MCP event tools › polls a negotiation's events by cursor, carrying no mandate figure | `events.test.ts` | pass |
| BCP-MCPEVT-04 | non-normative | MCP event tools › reads the resource and notifies a subscriber when new events arrive | `events.test.ts` | pass |
| BCP-MCPEVT-05 | non-normative | MCP event tools › reports a node with the feed off as a tool error, not a crash | `events.test.ts` | pass |
| BCP-DESK-01 | non-normative | copy dictionaries › ships English and Spanish only | `copy-parity.test.ts` | pass |
| BCP-DESK-02 | non-normative | copy dictionaries › has the same shape in Spanish as in English | `copy-parity.test.ts` | pass |
| BCP-DESK-03 | non-normative | copy dictionaries › has no empty strings | `copy-parity.test.ts` | pass |
| BCP-DESK-04 | non-normative | copy dictionaries › is actually translated (most Spanish strings differ from English) | `copy-parity.test.ts` | pass |
| BCP-DESK-05 | non-normative | copy dictionaries › carries no Hebrew text | `copy-parity.test.ts` | pass |
| BCP-DESK-06 | non-normative | omni dictionaries › ships English and Spanish only | `copy-parity.test.ts` | pass |
| BCP-DESK-07 | non-normative | omni dictionaries › has the same shape in Spanish as in English | `copy-parity.test.ts` | pass |
| BCP-DESK-08 | non-normative | omni dictionaries › has no empty strings | `copy-parity.test.ts` | pass |
| BCP-DESK-09 | non-normative | omni dictionaries › is actually translated (most Spanish strings differ from English) | `copy-parity.test.ts` | pass |
| BCP-DESK-10 | non-normative | omni dictionaries › carries no Hebrew text | `copy-parity.test.ts` | pass |
| BCP-DESK-11 | non-normative | desk dictionaries › ships English and Spanish only | `copy-parity.test.ts` | pass |
| BCP-DESK-12 | non-normative | desk dictionaries › has the same shape in Spanish as in English | `copy-parity.test.ts` | pass |
| BCP-DESK-13 | non-normative | desk dictionaries › has no empty strings | `copy-parity.test.ts` | pass |
| BCP-DESK-14 | non-normative | desk dictionaries › is actually translated (most Spanish strings differ from English) | `copy-parity.test.ts` | pass |
| BCP-DESK-15 | non-normative | desk dictionaries › carries no Hebrew text | `copy-parity.test.ts` | pass |
<!-- END CONFORMANCE -->