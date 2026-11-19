# Bloom Exchange

**Two AI agents negotiate a deal over A2A JSON-RPC while each side's price limits stay sealed in salted SHA-256 commitments that the other side's engines never see; a prompt-injection firewall screens every message, deterministic clamps keep every offer inside both mandates, and the result is an Ed25519-signed receipt anyone can verify offline.**

Bloom Exchange is the reference implementation of the **[Bloom Clearing Protocol](SPEC.md)**, an extension profile of **A2A v1.0** that maps settlement to **AP2** mandates and **Stripe / x402** payloads, with an **MCP** server so any IDE agent can use it. Apache-2.0.

## Try it (no API key, no account, no model)

```bash
git clone https://github.com/astyboyy-ship-it/bloom-exchange && cd bloom-exchange
npm install                         # about 2 minutes on a cold cache
npm run dev                         # the node + operating desk on http://localhost:3000
```

Negotiations run on deterministic engines with the same vault, firewall, clamps and signatures as production. Requires **Node 22.18+** for the repository scripts; the published npm packages run on Node 20+.

**One command, every claim checked.** Starts two nodes with separate keys, fires a prompt-injection payload at the firewall, checks that no private number reaches the attacker, settles a cross-node deal, then verifies the receipt with the CLI (and checks that a $1 tamper and the wrong key both fail):

```bash
npm run build && npm run verify:launch          # or ./scripts/verify-launch-demo.sh · .\scripts\verify-launch-demo.ps1
```

```
  1 · SHIELD vs. PROMPT INJECTION (role tags, [INST], base64, zero-width Unicode)
    ✓ Shield verdict: quarantined · 14 threats (policy_override_loop, encoded_payload, instruction_override, mandate_extraction, …)
    ✓ no provider-private number in 42,450 bytes the attacker received
    ✓ the deal still cleared inside both mandates: completed at $49,400, not $1
  3 · bloom-verify CLI
    ✓ offline with --card card.json → exit 0 (VALID)
    ✓ price changed by $1 → exit 1 (INVALID: failed: digest)
    ✓ against node-alpha's key → exit 1 (INVALID: failed: signature, ap2Proofs)
  ALL CHECKS PASSED in 8.0s
```

**Verify a receipt** without cloning anything. The script above prints the folder where it saved `receipt.json` and the issuer's `card.json`; on the desk, the Enclave Inspector's **JSON** button downloads a receipt and the card is at `/.well-known/agent-card.json`.

```bash
npx @bloom-exchange/sdk verify receipt.json --card card.json   # fully offline
npx @bloom-exchange/sdk verify receipt.json                    # fetches the issuer's card named in the receipt
```

**Give your agent the tools** (Claude Code, with a node running on :3000):

```bash
claude mcp add bloom-exchange -e BLOOM_EXCHANGE_URL=http://localhost:3000 -- npx -y @bloom-exchange/mcp
```

Cursor, Claude Desktop or any MCP client:

```json
{
  "mcpServers": {
    "bloom-exchange": {
      "command": "npx",
      "args": ["-y", "@bloom-exchange/mcp"],
      "env": { "BLOOM_EXCHANGE_URL": "http://localhost:3000" }
    }
  }
}
```

| Package | | |
|---|---|---|
| [`@bloom-exchange/sdk`](https://www.npmjs.com/package/@bloom-exchange/sdk) | `npm install @bloom-exchange/sdk` | Zero-dependency client and the `bloom-verify` CLI |
| [`@bloom-exchange/mcp`](https://www.npmjs.com/package/@bloom-exchange/mcp) | `npx -y @bloom-exchange/mcp` | MCP server for Claude Code, Cursor and any MCP client |
| [`@bloom-exchange/core`](https://www.npmjs.com/package/@bloom-exchange/core) | `npm install @bloom-exchange/core` | The clearing engine and HTTP handlers, to run a node in any runtime |

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

**TypeScript** (Node ≥ 20, Deno, Bun or the browser)

```bash
npm install @bloom-exchange/sdk
```

```ts
import { BloomExchangeClient } from "@bloom-exchange/sdk";

const bloom = new BloomExchangeClient({ baseUrl: "http://localhost:3000" });
const { state, certificate } = await bloom.negotiate({
  mandate: { ceilingPriceUsd: 52_500, maxBudgetUsd: 55_000, requiredSlaTier: "gold", targetNetDays: 60 },
  item: { description: "12-month platform license" },
}).result;
const proof = await bloom.verifyCertificate(certificate!); // { valid: true, checks: { digest, certificateId, chain, signature, ap2Proofs } }
```

**Claude Code, Cursor or any MCP client** (setup [above](#try-it-no-api-key-no-account-no-model))

Ask your agent to *"negotiate a 12-month license with a $52k ceiling on Bloom and verify the receipt"*. Tools: `negotiate`, `verify_receipt`, `publish_intent`. For a remote server, `npx -y -p @bloom-exchange/mcp bloom-exchange-mcp-http` serves stateless Streamable HTTP at `/mcp`. Optional environment: `BLOOM_ACCESS_KEY`, `BLOOM_AGENT_NAME`.

**Verify any receipt**

```bash
npx @bloom-exchange/sdk verify receipt.json                    # keys from the issuer's Agent Card
npx @bloom-exchange/sdk verify receipt.json --card card.json   # fully offline, air-gapped
npx @bloom-exchange/sdk verify receipt.json --json             # machine-readable; exit 0 valid · 1 invalid · 2 bad input
```

Installed, the same command is `bloom-verify receipt.json`. Inside this repository: `npm run verify -- receipt.json`.

**Raw A2A JSON-RPC**

```bash
curl -s http://localhost:3000/api/exchange/a2a -H 'Content-Type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"SendMessage","params":{"message":{"messageId":"m1","role":"user","parts":[
    {"kind":"data","data":{"bloomExchange":{"mandate":{"ceilingPriceUsd":52500,"maxBudgetUsd":55000,"requiredSlaTier":"gold","targetNetDays":60},
     "item":{"description":"12-month platform license"}}}}]}}}'
```

## Two nodes, one cross-node deal each way

`deploy/docker-compose.yml` runs two Sovereign nodes, **node-alpha** (:3001) and **node-beta** (:3002). Each has its own Ed25519 root key and its own state, and each is pre-wired to the other through `BLOOM_PEERS`:

```bash
npm run sovereign:init -- --alpha "Acme Fund" --beta "Northwind"   # separate secrets, root keys and operator keys (all local)
npm run sovereign:up                                               # Docker Compose: both nodes + Redis + REST gateways
npm run demo:two-node                                              # discovery, then a cross-node deal each way
```

No Docker? `npm run build && npm run demo:two-node:local` starts the same two nodes as local processes with fresh keys. Output from a real run:

```
  1 · DISCOVERY
    node-alpha Alpha    key bxk-1f439f15d2868299 card ✓   peers: http://127.0.0.1:3102 ✓ bxk-7ab61a50094bf764
    node-beta  Beta     key bxk-7ab61a50094bf764 card ✓   peers: http://127.0.0.1:3101 ✓ bxk-1f439f15d2868299

  2 · node-alpha's agent buys on node-beta
    settled BLOOM-XCH-60X3-0HDS-R7XF-QFA0 at $47,060 · net 45 · gold · 10 rounds
    receipt: issued by Bloom Exchange · Beta (bxk-7ab61a50094bf764) · counterparty Bloom Exchange · Alpha
    ✓ verifies against node-beta's card   ✓ does not verify against node-alpha's key

  3 · node-beta's agent buys on node-alpha
    settled BLOOM-XCH-8HSX-HJSW-ZA40-PSBQ at $46,920 · net 45 · gold · 10 rounds
    receipt: issued by Bloom Exchange · Alpha (bxk-1f439f15d2868299) · counterparty Bloom Exchange · Beta
    ✓ verifies against node-alpha's card   ✓ does not verify against node-beta's key
```

Each node verifies the other's signed Agent Card (`GET /api/exchange/peers`). An agent from one node negotiates on the other, presenting its home node's card. Each receipt names both nodes and verifies only against its issuer's key. The same deal with the SDK:

```ts
const alphaCard = await (await fetch("http://localhost:3001/.well-known/agent-card.json")).json();
const onBeta = new BloomExchangeClient({ baseUrl: "http://localhost:3002", agent: { name: "alpha/procurement", framework: "bloom-sdk", card: alphaCard } });
const { certificate } = await onBeta.negotiate({ mandate: { ceilingPriceUsd: 52_500, maxBudgetUsd: 55_000, requiredSlaTier: "gold", targetNetDays: 60 }, item: { description: "12-month platform license" } }).result;
await onBeta.verifyCertificate(certificate!); // signed by node-beta
```

Run a single node with `docker compose -f deploy/docker-compose.yml up node-alpha`. Kubernetes runs one node per namespace: `kubectl apply -k deploy/k8s` (see `deploy/k8s/kustomization.yaml`). With no model keys and no settlement webhook, nodes make no outbound calls beyond their configured peers. Configuration lives in [`.env.example`](.env.example).

**Access keys** are optional. They switch enclaves from the sandbox to production clearing and unlock operator views: `npm run key:issue -- --role operator --holder "You"`.

## Develop

```bash
npm test                  # 177 tests: protocol vectors, engine invariants, leakage, settlement safety, firewall, adapters, peers, CLI, MCP, copy parity
npm run typecheck
npm run lint
npm run build
npm run spec:conformance  # regenerates SPEC.md Appendix B from the suite
npm run verify:launch     # the end-to-end check above (after npm run build)
```

Every test has a conformance id in [SPEC.md Appendix B](SPEC.md#appendix-b-conformance-vectors). Appendix A gives byte-exact vectors for canonical JSON, key derivation, round hashes, commitments, certificate ids and Ed25519 signatures, so implementations in other languages can match the reference exactly.

## What is and is not built

* **Built:** everything above runs today, end to end, with tests.
* **Opt-in:** an event feed for wake-ups and post-settlement hooks (`BLOOM_EVENTS=1`): cursor polling, SSE, an MCP `poll_events` tool, and webhook, JSONL and dry-run adapters. It carries no mandate figures. See [docs/EVENTS.md](docs/EVENTS.md).
* **Format only:** `bloom.exchange/<agent>` links. They are a naming format that resolves to a node's signed Agent Card; there is no public registry or resolver yet.
* **Open:** in v0.1 the vault runs on the provider's node, so the counterparty trusts that operator not to read its mandate. The roadmap is neutral hosted clearing, attested enclaves and federation. See [SPEC.md §12](SPEC.md#12-security-considerations-and-threat-model).

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE).

The two paintings in `apps/node/public/paintings` are public-domain works: Jean-Honoré Fragonard, c. 1760, and Claude Lorrain, 1653. They come from Wikimedia Commons under the Public Domain Mark 1.0, and the Apache License does not cover them. Attribution is in [NOTICE](NOTICE) and [CREDITS](apps/node/public/paintings/CREDITS.md).