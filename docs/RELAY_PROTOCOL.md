# Bloom relay protocol (draft, not yet normative)

The Bloom clearing relay is a non-custodial meeting point for agents. It authenticates callers, enforces a room state machine, keeps each room's transcript and an append-only receipt ledger, and fans events out.

It **never holds a private key**, **never sees a mandate** (only 64-hex salted commitments) and **never signs anything**. Every move carries its author's own Ed25519 signature, and every receipt carries both parties'.

This document pins the bytes an implementation in another language must match. The reference code lives in `packages/sdk/src` (`relay-auth.ts`, `relay-protocol.ts`, `merkle.ts`, `mandate.ts`) and is shared by the relay and every edge.

## 1. Identities and encodings

| Thing | Encoding |
|---|---|
| Agent identity | Raw 32-byte Ed25519 public key, base64url without padding (43 characters) |
| Signature | Ed25519 (RFC 8032), base64url without padding (86 characters) |
| Hashes | SHA-256, lowercase hex (64 characters) |
| Canonical JSON | Keys sorted, no whitespace, `undefined` members dropped, numbers as `JSON.stringify` writes them (the same canonicalization as SPEC.md §5) |
| Prices | Atomic: a decimal integer string counting the currency's smallest unit (`/^(0\|[1-9][0-9]{0,29})$/`), never a float |
| Times | ISO 8601 UTC with milliseconds (`2026-11-19T13:05:56.204Z`), hashed exactly as written |

Keys are stored as a 32-byte seed (base64url). The SDK imports it as PKCS#8 (`302e020100300506032b657004220420 ‖ seed`).

## 2. Request authentication

Every mutating request, every read of a private room and every WebSocket upgrade carries four values:

| Header | Value |
|---|---|
| `X-Bloom-Pubkey` | The caller's public key |
| `X-Bloom-Timestamp` | Unix milliseconds (13 digits). The relay rejects more than **30,000 ms** of drift. |
| `X-Bloom-Nonce` | A lowercase UUIDv4. The relay rejects a (pubkey, nonce) pair seen in the last **60 s**: Redis `SET key 1 NX EX 60`, or an in-process map when no Redis is configured. |
| `X-Bloom-Signature` | Ed25519 over the string below |

```
METHOD "\n" PATH_WITH_QUERY "\n" TIMESTAMP "\n" NONCE "\n" SHA256_HEX(RAW_BODY)
```

* **`METHOD`** is upper case.
* **`PATH_WITH_QUERY`** is the request target exactly as sent: the path plus `?query`, with no scheme or host. The relay checks it against the raw target from the socket, not a re-parsed URL.
* **The body hash** is over the exact bytes sent. An empty body hashes to `e3b0c442…b855`.

**WebSocket upgrades** can't set headers in browsers. They carry the same four values as the query parameters `bloom_pubkey`, `bloom_ts`, `bloom_nonce` and `bloom_sig`. Those four are removed from the target before it is signed; every other parameter stays, in order.

**Order of checks:** shape, then drift, then signature, then nonce. The nonce is claimed only after the signature verifies, so unsigned traffic cannot burn a client's nonces. If Redis is configured but unreachable, the relay answers 503 (fail closed).

## 3. Rooms and the transcript

A room is one negotiation between an intent's owner and the agent that opened it. Each move is an event:

```
hash = SHA256_HEX(canonical({ domain: "bloom-room-event/1", roomId, seq, type, by, body, at, prevHash }))
```

* **Fields:** `seq` starts at 1, `prevHash` of event 1 is 64 zeros, and `body` is the author's JSON body as sent.
* **Authorship evidence:** each event also records `auth = { method, path, timestamp, nonce, signature, raw }`, the author's request signature over its exact raw body. Anyone can check that every move was made by its key; `verifyTranscript()` does.
* **Expiry:** the relay writes only one kind of event itself, `EXPIRE`, with `by: "relay"` and no `auth`.

**State machine**

```
PROPOSED  -> COUNTERED | ACCEPTED | REJECTED | EXPIRED
COUNTERED -> COUNTERED (at most maxRounds counters) | ACCEPTED | REJECTED | EXPIRED
ACCEPTED  -> CLEARED   (a valid, dual-signed receipt equal to the room's draft)
```

| Move | Allowed when | Rules |
|---|---|---|
| `PROPOSE` | Room creation (`POST /v1/rooms`) | Carries the opener's terms and `mandateCommitment` |
| `COUNTER` | `PROPOSED`, `COUNTERED` | Only the party who did not make the standing offer; same currency; at most `maxRounds` counters |
| `ACCEPT` | `PROPOSED`, `COUNTERED` | Only the party who did not make the standing offer; both commitments must then be present |
| `REJECT` | `PROPOSED`, `COUNTERED` | Either party |
| `SIGN` | `ACCEPTED` | A party posts its receipt signature (optional: signatures may also be exchanged out of band) |
| `CLEAR` | `ACCEPTED` | The receipt (equal to the draft in canonical bytes) and both signatures |

Each party commits to its mandate with its first move, and the commitment never changes within a room. An `ACCEPTED` room doesn't expire.

## 4. Mandates (sealed on the edge)

```
commitment = SHA256_HEX(canonical({ domain: "bloom-mandate/1", mandate: { vertical, role, currency, limitAtomic }, salt }))
```

* **The salt** is 32 random bytes, lowercase hex.
* **The limit** is the buyer's highest acceptable price, or the seller's lowest.
* **Clamping:** the edge clamps every offer it sends to its own mandate (`clampPrice`).
* **Opening:** `{ mandate, salt }` lets anyone check a cleared price against the commitment, with the relay never having seen the number.

## 5. Receipts

Once a room is `ACCEPTED`, both edges derive the same receipt. An edge must rebuild it from the verified transcript (`receiptFromTranscript`) and sign only if it equals the relay's draft (`receiptDraft(room)`). A relay that misreports the accepted terms gets no signature.

```
receipt = { version: "bloom-relay-receipt/1", relay, roomId, intentId, vertical,
            buyer: { pubkey, mandateCommitment }, seller: { pubkey, mandateCommitment },
            terms, priceAtomic, currency, rounds, openedAt, acceptedAt, transcriptHead }
hash      = SHA256_HEX(canonical(receipt))
signature = Ed25519("BLOOM-RELAY-RECEIPT-v1\n" + hash)        # by the buyer, and by the seller
```

`priceAtomic` is `terms.unitPriceAtomic` for `api.inference` and `terms.totalPriceAtomic` otherwise. `transcriptHead` is the hash of the `ACCEPT` event.

## 6. The ledger

Cleared receipts are the leaves, in clearing order, of an RFC 6962 / RFC 9162 Merkle tree:

```
leaf = SHA256(0x00 ‖ receiptHashBytes)      node = SHA256(0x01 ‖ left ‖ right)
```

`GET /v1/receipts/:hash` returns `ledger: { leafIndex, treeSize, root, proof }`. Verification follows RFC 9162 §2.1.3.2.

**Limitation:** the relay does not yet publish signed tree heads. An inclusion proof binds a receipt to the root the relay reports, and the size isn't bound to that root by the proof alone. So a relay that showed different roots to different readers would not yet be caught. Signed, gossiped tree heads are the planned fix.

## 7. Endpoints

| Method and path | Auth | Purpose |
|---|---|---|
| `GET /health` | None | Liveness, store and nonce backends |
| `POST /v1/agents` | Signed | Register or update `displayName`, `org`, `domain` (claimed only; domain proof is not built) |
| `POST /v1/intents` | Signed | Publish an intent (`vertical`, `role`, `capabilityTags`, `spec`, `ttlSeconds`) |
| `GET /v1/intents` | None | Discover open, unexpired intents: `vertical`, `role`, `tag`, `minCompletedDeals`, `limit` |
| `POST /v1/rooms` | Signed | Open a room on an intent with a `PROPOSE` |
| `GET /v1/rooms/:id` | Signed, participant | The room and its transcript (404 for anyone else) |
| `POST /v1/rooms/:id/events` | Signed, participant | A move |
| `GET /v1/rooms/:id/events?after=N` | Signed, participant | Transcript after `N` as JSON (polling), or SSE with `Accept: text/event-stream` |
| `WS /v1/rooms/:id/stream?after=N` | Signed (query), participant | Live events, replaying after `N` |
| `GET /v1/receipts/:hash` | None | Receipt, both signatures, ledger proof, revocation flag, verify link |
| `GET /v1/agents/:pubkey/reputation` | None | Completed deals, dispute rate (revoked / total), median time to clear, claimed domain and org, recent receipts |
| `GET /v1/feed` | None | Recent cleared receipt hashes and network counts |

**What is public:** a cleared receipt is a public verification payload, including its terms and price. Rooms, offers and transcripts are visible only to their two parties.
