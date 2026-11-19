# Changelog

`@bloom-exchange/core`, `@bloom-exchange/sdk` and `@bloom-exchange/mcp` are versioned in lockstep. The protocol is versioned separately: this release still implements the Bloom Clearing Protocol v0.1 and the `bloom-xch/1.0` certificate format ([SPEC.md](SPEC.md)).

## Unreleased: Phase 2, the clearing relay (preview)

### Added

* **`@bloom-exchange/schemas`**: zero-dependency validators and types for `api.inference`, `compute.gpu` and `data.retrieval` terms. Fields are strict (unknown keys are rejected) and prices are atomic integer strings, never floats.
* **SDK edge layer.** The SDK stays zero-dependency.
  * `AgentKey`: Ed25519 on Web Crypto, matching the RFC 8032 test vectors.
  * Request signing: `X-Bloom-Pubkey`, `-Timestamp`, `-Nonce` and `-Signature`.
  * Sealed mandate commitments and edge clamping.
  * An RFC 6962 Merkle ledger.
  * The room protocol and dual-signed receipts. `receiptFromTranscript` lets an edge refuse to sign a draft that differs from the signed transcript.
  * `RelayTransport`: publish, discover, open rooms, moves, and subscriptions over WebSocket with SSE and polling fallbacks; plus receipt verification.
* **`apps/relay`**: the non-custodial relay (Hono and `ws`).
  * Ed25519 request auth, with a 30 s drift window and nonces that can't be replayed, backed by Redis `SET NX EX 60`, or memory when no Redis is configured.
  * The room state machine, the signed transcript, and an append-only receipt ledger with Merkle inclusion proofs.
  * Reputation and a public feed.
  * Postgres (`supabase/migrations/001_phase2_relay.sql`) and Upstash in production; zero-config memory locally.
  * Runs on Vercel as one Node.js function (`apps/relay/vercel.json`), with SSE and polling, or on any long-running server (Dockerfile, `fly.toml`), which adds WebSocket. SSE streams read the shared store, so they work across instances and serverless invocations; `/health` advertises the transports.
  * Includes `.env.example`.
* **`apps/verifier`**: browser-side verification of receipts, a live network feed, and agent passports.
* **MCP**: `bloom_publish_intent`, `bloom_discover_counterparties` and `bloom_verify_receipt`, configured with `BLOOM_RELAY_URL`, `BLOOM_VERIFIER_URL` and `BLOOM_AGENT_SEED`.
* **Docs**: [docs/RELAY_PROTOCOL.md](docs/RELAY_PROTOCOL.md).

### Not yet

Signed tree heads, domain verification, WebSocket fan-out across relay instances, rate limiting and a revocation endpoint. `bloom-exchange-relay.vercel.app` and `bloom-exchange-verify.vercel.app` are not deployed.

## 0.2.0 (2026-11-19)

### Added

* **Event feed (opt-in, `BLOOM_EVENTS=1`).** A typed, redacted lifecycle feed for wake-ups and post-settlement hooks. See [docs/EVENTS.md](docs/EVENTS.md).
  * Eight event types, from `negotiation.opened` to `receipt.issued`. Each event is built field by field: no mandate figure, margin, clamp value or free text ever enters it.
  * Every event carries a `bxe_…` id, a resumable `cursor`, its `audience`, and `node`: the producing node's signing key id, so receivers that aggregate several nodes can attribute every event.
  * `GET /api/exchange/events` serves a JSON page by cursor, or SSE with `Last-Event-ID` resume.
  * **Who sees what** mirrors GetTask:
    * the Operator key sees every event;
    * another access key sees its own tasks;
    * anyone sees the sandbox tasks whose ids it presents (`?taskId=`, up to 100).
  * Operator-side events (clamps, exception kinds) reach non-operators only in the sandbox.
  * Feed reads have their own budget of 120 per minute, so polling never starves negotiations.
* **Adapters.** Each adapter gets an ordered, bounded queue with retries and a dead-letter list.
  * `WebhookAdapter`: exact-origin allowlist; https, or http to loopback; DNS checked against private ranges and the connection pinned to the checked address; no redirects; a 4 s deadline; status-code-only handling; optional HMAC `Bloom-Signature`.
  * `JsonlSinkAdapter` writes a local audit file, and `MockTriggerAdapter` is a dry run.
  * New subpath: `@bloom-exchange/core/events`.
* **MCP.** A `poll_events` tool, and a `bloom://events` resource that is subscribable over stdio.
* **Public-URL guardrails.**
  * A production node without `BLOOM_EXCHANGE_PUBLIC_URL` warns once.
  * `/api/exchange/node` reports `posture.publicUrl` (`configured` or `request-host`) and `posture.publicUrlRequired`.
  * `BLOOM_EXCHANGE_REQUIRE_PUBLIC_URL=1` refuses binding negotiations until the URL is set, with error `-32053` (HTTP 503 on REST). Sandbox is unaffected.

### Fixed

* **x402 `resource` in signed certificates.** It now names the task's A2A resource, `/api/exchange/a2a/v1/tasks/{id}`, which the payer can fetch. 0.1.0 named the provider's operator view, `/api/exchange/tasks/{id}`, which answered 404 to a production payer. Only the value changed: 0.1.0 certificates remain valid, and the Appendix A vectors are unchanged.

### Changed

* **`BLOOM_EXCHANGE_PUBLIC_URL` is validated.** When set, it must be a bare `http(s)` origin, because it is written into every signed receipt.
  * A Next.js node with an invalid value exits at startup with a message saying what to fix.
  * Other hosts fail each request until the value is fixed.
  * 0.1.0 used any value as-is.

### Upgrade notes

* **Check `BLOOM_EXCHANGE_PUBLIC_URL`** if you set it. A path (`https://host/bloom`), a missing scheme (`host.example`) or credentials now stop the node instead of being written into receipts.
* **Expect the new x402 path.** Receivers that matched the old `x402.resource` path should accept `/api/exchange/a2a/v1/tasks/{id}`.
* **Nothing else changes by default.** The event feed is off unless `BLOOM_EVENTS=1`, and strict mode is off unless `BLOOM_EXCHANGE_REQUIRE_PUBLIC_URL=1`.

## 0.1.0 (2026-11-18)

First public release: the clearing engine with its double-blind vault, Shield firewall and Sovereign clamping; Ed25519-signed `bloom-xch/1.0` certificates; the zero-dependency SDK and `bloom-verify` CLI; and the MCP server with `negotiate`, `verify_receipt` and `publish_intent`.
