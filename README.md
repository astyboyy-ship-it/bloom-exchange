# Bloom Exchange

**The open clearing layer for the agentic economy.** Agents meet through a signed link, negotiate inside a double-blind sandbox where neither side's limits can leak, and settle with an Ed25519 receipt that anyone can verify offline. No feeds, no cold email, no sales calls: intent, sealed commitments and proof.

Bloom Exchange is the reference implementation of the **[Bloom Clearing Protocol](SPEC.md)**, an extension profile of **A2A v1.0** that maps settlement to **AP2** mandates and **Stripe / x402** payloads, with an **MCP** server so any IDE agent can use it.

```bash
npm install
npm run dev                         # the node + operating desk on http://localhost:3000
```

The sandbox needs no key, no account and no model: negotiations run on deterministic engines with the same vault, firewall, clamps and signatures as production.

## What you get

| | |
|---|---|
| **Double-blind vault** | Each side's limits are sealed with salted SHA-256 commitments. The provider's engines (and any prompt they build) receive a brief with no counterparty field, so the client's ceiling cannot reach them by construction. Guard bands keep every offer off every private number; a leak scrubber checks every outbound message. |
| **Deterministic clamping** | Models only propose. Sovereign clamps every offer to both mandates before it is sent or signed. 300 randomized enclaves with an adversarial proposer never produce an out-of-bounds offer. |
| **Shield firewall** | Prompt injection, policy overrides, invisible and tag-smuggled Unicode, homoglyphs, base64 payloads, hidden markup and token exhaustion are neutralized before any engine reads the text, with a hash-chained audit ledger. |
| **Verifiable receipts** | BLOOM-XCH certificates: hash-chained rounds, both mandate commitments, Ed25519 signature, AP2 checkout and payment credentials, Stripe and x402 payloads. `bloom-verify receipt.json` checks one offline. |
| **40 protocol adapters** | Chat, CRM, agent protocols (A2A, MCP, LangGraph, CrewAI, AutoGen), cloud and energy, payment rails and custom hooks normalize into one `AgentIntentNode`. |
| **The operating desk** | A negotiation sandbox, a clearing ledger, an enclave inspector with a live security graph and a boundary probe, the omni-protocol router, a mandate corridor, and an SDK quickstart, in English and Spanish. |

## Repository

```
packages/core   @bloom-exchange/core   the clearing engine: vault, Shield, Sovereign, settlement, adapters, HTTP handlers
packages/sdk    @bloom-exchange/sdk    zero-dependency TypeScript client and the bloom-verify CLI
packages/mcp    @bloom-exchange/mcp    MCP server (stdio and Streamable HTTP): negotiate, verify_receipt, publish_intent
apps/node       @bloom-exchange/node   a node: the API (A2A JSON-RPC, HTTP+JSON, SSE) and the operating desk at /
deploy/                                Dockerfile, Docker Compose and Kubernetes manifests for a Sovereign node
SPEC.md                                Bloom Clearing Protocol v0.1
```

Every endpoint in `packages/core/src/http` is a plain `(Request) => Response` function. `apps/node` mounts them in Next.js; `handle()` from `@bloom-exchange/core/http/router` serves them from any runtime (Node, Bun, Deno, Workers) or in-process.

## Connect an agent

**TypeScript**

```ts
import { BloomExchangeClient } from "@bloom-exchange/sdk";

const bloom = new BloomExchangeClient({ baseUrl: "http://localhost:3000" });
const { state, certificate } = await bloom.negotiate({
  mandate: { ceilingPriceUsd: 52_500, maxBudgetUsd: 55_000, requiredSlaTier: "gold", targetNetDays: 60 },
  item: { description: "12-month platform license" },
}).result;
const proof = await bloom.verifyCertificate(certificate!); // { valid: true, checks: { digest, certificateId, chain, signature, ap2Proofs } }
```

**Claude Code, Cursor or any MCP client**

```bash
npm run build
claude mcp add bloom-exchange -e BLOOM_EXCHANGE_URL=http://localhost:3000 -- node packages/mcp/dist/stdio.js
```

Then ask your agent to *"negotiate a 12-month license with a $52k ceiling on Bloom and verify the receipt"*. Tools: `negotiate`, `verify_receipt`, `publish_intent`. For a remote server, `bloom-exchange-mcp-http` serves stateless Streamable HTTP at `/mcp`.

**Verify any receipt**

```bash
npm run verify -- receipt.json                     # in this repo (after npm run build): keys from the issuer's Agent Card
npm run verify -- receipt.json --card card.json    # fully offline
npx bloom-verify receipt.json                      # once @bloom-exchange/sdk is published to npm
```

**Raw A2A JSON-RPC**

```bash
curl -s http://localhost:3000/api/exchange/a2a -H 'Content-Type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"SendMessage","params":{"message":{"messageId":"m1","role":"user","parts":[
    {"kind":"data","data":{"bloomExchange":{"mandate":{"ceilingPriceUsd":52500,"maxBudgetUsd":55000,"requiredSlaTier":"gold","targetNetDays":60},
     "item":{"description":"12-month platform license"}}}}]}}}'
```

## Run a Sovereign node

```bash
npm run sovereign:init -- --org "Acme Fund"   # secrets, Ed25519 root key record, operator key (all local)
npm run sovereign:up                          # Docker Compose: node + Redis + REST gateway on an internal network
```

Kubernetes: `kubectl apply -k deploy/k8s` (see `deploy/k8s/kustomization.yaml`). With no model keys and no settlement webhook, a node makes no outbound calls. Configuration lives in [`.env.example`](.env.example).

**Access keys** are optional. They switch enclaves from the sandbox to production clearing and unlock operator views: `npm run key:issue -- --role operator --holder "You"`.

## Develop

```bash
npm test             # 132 tests: engine invariants, leakage, settlement safety, firewall, adapters, CLI, MCP, copy parity
npm run typecheck
npm run build
```

## What is and is not built

* **Built:** everything above runs today, end to end, with tests.
* **Format only:** `bloom.exchange/<agent>` links. They are a naming format that resolves to a node's signed Agent Card; there is no public registry or resolver yet.
* **Open:** in v0.1 the vault runs on the provider's node, so the counterparty trusts that operator not to read its mandate. The roadmap is neutral hosted clearing, attested enclaves and federation. See [SPEC.md §12](SPEC.md#12-security-considerations-and-threat-model).

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE).
