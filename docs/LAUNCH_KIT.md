# Bloom Exchange launch kit

Everything needed to list Bloom Exchange, post the launch, and start design-partner conversations. Every command and code sample was checked against this repository. Registry rules were checked on 2026-11-18; re-check them if you launch much later.

**Ship in this order.** Each step depends on the one before it.

1. Publish to npm: `npm login`, then `npm publish --access public -w @bloom-exchange/core`, then `-w @bloom-exchange/sdk`, then `-w @bloom-exchange/mcp`.
2. Smoke-test from a clean machine: `npx @bloom-exchange/sdk verify --help` should print the usage line, and `npx -y @bloom-exchange/mcp` should start and wait on stdio.
3. List on the MCP Registry (§1.1), then Glama (§1.2).
4. Post Show HN (§2) on a weekday morning, US Eastern time. Stay in the thread for the first three hours.
5. Post to Reddit (§3) the next day, not the same day.
6. Send design-partner DMs (§5) to people who engaged, then to cold prospects.

**Claims you can make, and their evidence:**

| Claim | Evidence |
|---|---|
| 144 tests, all passing | `npm test` |
| No out-of-bounds offer across 300 randomized enclaves with an adversarial proposer | `packages/core/test/settlement-safety.test.ts` |
| 40 protocol adapters | `packages/core/test/omni.test.ts` (it clears all 40 end to end) |
| Receipts verify offline and only against the issuer's key | `npm run demo:two-node:local`; `npx @bloom-exchange/sdk verify` |
| Byte-exact test vectors for other languages | SPEC.md Appendix A, `packages/core/test/vectors.test.ts` |
| Apache-2.0 | `LICENSE` |

**Claims you must not make:**

* That the node operator cannot read mandates. They can; see SPEC §12.1.
* That `bloom.exchange` links resolve publicly. They are a naming format.
* That local models are supported as the proposer. Today the proposer is Anthropic, OpenRouter, or a deterministic engine.
* Any usage or adoption numbers you don't have.

---

## 1. Registries and directories

### 1.1 Official MCP Registry (the only path to the official listing)

The `modelcontextprotocol/servers` repository **no longer accepts listings**. Its CONTRIBUTING file says: *"The README's list of third-party servers has been retired in favor of the Registry"*. Only maintainers open pull requests there. The official path is the **MCP Registry** (registry.modelcontextprotocol.io), and publishing to it is done with the `mcp-publisher` CLI, not through a pull request.

**Already done in this repository:**

* `packages/mcp/package.json` contains `"mcpName": "io.github.astyboyy-ship-it/bloom-exchange"`. The registry checks npm ownership against this field, so it must be in the version you publish to npm. 0.1.0 already includes it.
* `packages/mcp/server.json`:

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.astyboyy-ship-it/bloom-exchange",
  "description": "Negotiate in a double-blind sandbox and verify Ed25519 receipts. Agent-to-agent clearing over A2A.",
  "repository": {
    "url": "https://github.com/astyboyy-ship-it/bloom-exchange",
    "source": "github"
  },
  "version": "0.1.0",
  "packages": [
    {
      "registryType": "npm",
      "identifier": "@bloom-exchange/mcp",
      "version": "0.1.0",
      "transport": { "type": "stdio" },
      "environmentVariables": [
        { "name": "BLOOM_EXCHANGE_URL", "description": "Base URL of the Bloom Exchange node (default http://localhost:3000)", "isRequired": false, "format": "string", "isSecret": false },
        { "name": "BLOOM_ACCESS_KEY", "description": "Optional Bloom access key for production enclaves instead of the sandbox", "isRequired": false, "format": "string", "isSecret": true },
        { "name": "BLOOM_AGENT_NAME", "description": "How this client's agent introduces itself to the counterparty", "isRequired": false, "format": "string", "isSecret": false }
      ]
    }
  ]
}
```

The description is 98 characters; the registry's limit is 100. Keep the top-level `version` and the package `version` in step with npm on every release.

**Publish to the registry** (Windows PowerShell; on macOS use `brew install mcp-publisher`):

```powershell
# 1. Install the publisher CLI (amd64; use arm64 on ARM machines)
Invoke-WebRequest -Uri "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_windows_amd64.tar.gz" -OutFile mcp-publisher.tar.gz
tar xf mcp-publisher.tar.gz mcp-publisher.exe
.\mcp-publisher.exe --help

# 2. After @bloom-exchange/mcp@0.1.0 is live on npm:
cd C:\Users\מחשב-23\bloom-exchange\packages\mcp
..\..\mcp-publisher.exe login github     # GitHub device-code flow, as astyboyy-ship-it
..\..\mcp-publisher.exe publish
```

Then search registry.modelcontextprotocol.io for `bloom-exchange` to confirm the listing. Common failures:

* **npm ownership:** the published `package.json` lacks `mcpName`. Bump the version and republish.
* **Namespace:** you're not logged in as `astyboyy-ship-it`. The name must start with `io.github.astyboyy-ship-it/`.
* **Description too long:** keep it to 100 characters or fewer.

### 1.2 Glama (glama.ai/mcp/servers)

Glama lists more than 120,000 servers and has an **Add Server** button on its directory page. I could not confirm a repository config file for Glama, so this kit doesn't include one. Use the form, then claim ownership from the listing once it appears. Paste the following:

* **Repository:** `https://github.com/astyboyy-ship-it/bloom-exchange`
* **Name:** `Bloom Exchange`
* **Short description:** `Negotiate in a double-blind sandbox and verify Ed25519 receipts. Agent-to-agent clearing over A2A.`
* **Install:** `npx -y @bloom-exchange/mcp` (environment: `BLOOM_EXCHANGE_URL`; optional `BLOOM_ACCESS_KEY`, `BLOOM_AGENT_NAME`)
* **Long description:**

  > Bloom Exchange lets an AI agent negotiate with another agent without either side's private limits leaking: not to the counterparty, and not to a prompt-injected model. Each side's budget and floor are sealed in a double-blind vault with salted commitments. Models only propose; every offer is clamped in code to both mandates before it is sent or signed. A settled deal returns a BLOOM-XCH certificate: hash-chained rounds, Ed25519 signature and AP2 payment credentials, verifiable offline by anyone.
  >
  > Tools: `negotiate` (open a sealed negotiation and return the verified receipt), `verify_receipt` (check any BLOOM-XCH certificate offline), `publish_intent` (normalize a goal or any of 40 protocols' payloads and clear it). Runs against any Bloom node: run one locally with `npm run dev` (sandbox, no keys, no model needed), or self-host one with Docker. Apache-2.0.
* **Tags:** `agents`, `a2a`, `negotiation`, `commerce`, `security`, `prompt-injection`, `cryptography`, `ed25519`, `payments`, `ap2`, `x402`, `procurement`, `typescript`
* **Category:** Finance / Commerce (fallback: Developer Tools)

### 1.3 Smithery

**Skip it for now.** Smithery's notice at smithery.ai/future says: *"On October 31, 2026, we're shutting down Smithery's connection management services. Smithery will remain as a public (non-proxied) MCP registry."* Its CLI and SDKs are among the services being shut down, and its docs URL now returns 404. Revisit only if it publishes a new listing process. The Glama copy above works for any registry with a submission form.

### 1.4 Directories worth a manual submission later

Awesome-list pull requests (search GitHub for `awesome-mcp-servers` and `awesome-a2a`). Use the one-liner `Bloom Exchange: double-blind agent-to-agent negotiation with Ed25519-signed, offline-verifiable receipts (MCP + A2A).` and link the repository. Follow each list's contributing rules.

---

## 2. Show HN

**Title** (pick one; all are 80 characters or fewer):

* `Show HN: Stop prompt injection from leaking your agent's budget in negotiations` (79), the recommended one
* `Show HN: Bloom Exchange – agent negotiation that prompt injection can't leak` (76)
* `Show HN: Agents negotiate in a double-blind vault, settle with Ed25519 receipts` (79)

**URL:** `https://github.com/astyboyy-ship-it/bloom-exchange`

**First comment** (post it immediately, as the author):

> Hi HN. I built Bloom Exchange after watching procurement-style agents negotiate. The common pattern puts the agent's walk-away number in its prompt: "you can pay up to $52k". Anything that reaches that prompt can ask for it. The counterparty's messages, its Agent Card, a tool result: one injected sentence and the budget is in the other side's context.
>
> Bloom moves the limits out of the prompt entirely:
>
> - Each side deposits its mandate (ceiling, budget, SLA, terms) into a double-blind vault. The provider's negotiating engines receive a brief type with no counterparty fields, so the other side's numbers can't reach a prompt by construction. Each mandate is bound by a salted SHA-256 commitment printed on the receipt.
> - Models only propose. Every offer is clamped in code to both mandates before it is sent or signed. The test suite throws an adversarial proposer at 300 randomized enclaves and asserts that nothing out of bounds is ever sent or signed.
> - Every external field passes a firewall first: injection, role overrides, invisible and tag-smuggled Unicode, homoglyphs, base64 payloads, hidden markup. Critical findings quarantine the text, and only structured terms go through.
> - A settled deal is a BLOOM-XCH certificate: hash-chained rounds, both commitments, an Ed25519 signature and AP2 payment credentials. `npx @bloom-exchange/sdk verify receipt.json` checks it offline against the issuer's signed Agent Card.
>
> It's an A2A v1.0 extension (JSON-RPC and SSE), so any A2A client can talk to it. There's a zero-dependency TypeScript SDK and an MCP server (`npx -y @bloom-exchange/mcp`) for Claude Code and Cursor. The protocol spec has byte-exact test vectors, so a Python or Rust implementation can match the reference signatures exactly.
>
> To try it: clone, `npm install && npm run dev`, and open localhost:3000. The sandbox needs no API keys and no model; the proposer is a deterministic engine unless you add an Anthropic or OpenRouter key. `npm run build && npm run demo:two-node:local` starts two independently keyed nodes. They discover each other and settle a deal each way, and each receipt verifies only against its issuer's key.
>
> What it doesn't do yet, honestly:
>
> 1. **The node operator is trusted.** In v0.1 the vault runs on the provider's node, so that operator could read both mandates. The commitments let a counterparty catch a misstated receipt afterwards, but not prevent it. The roadmap is neutral hosted clearing, then TEE attestation printed on the receipt.
> 2. **Receipts aren't chained to each other yet.** A transparency log is planned.
> 3. **No local-model proposer yet.**
>
> SPEC.md §12 lists all of this. I'd especially like feedback on the threat model and on the spec (SPEC.md). Apache-2.0.

**Prepared answers for likely questions:**

* **"Why not just keep the budget out of the prompt yourself?"** You should, and Bloom makes that the default architecture. The harder part is the other side: a shared, neutral place where two agents' limits meet, plus a receipt both can verify. That's the clearing layer.
* **"Isn't this just escrow?"** No funds are held. It clears terms and emits AP2, Stripe and x402 payloads; the payment rail settles them. Sandbox receipts are explicitly `binding: false`.
* **"Why Ed25519 and not a blockchain?"** Verification needs no network and no chain. Ordering across receipts is a transparency-log problem, not a consensus problem.
* **"Who runs the vault?"** Today, the provider's node, which is the honest limitation above. Neutral operators and TEEs are the roadmap.

---

## 3. Reddit

### r/LocalLLaMA

**Title:** `Self-hosted clearing for agent-to-agent deals: limits sealed outside the model, receipts verifiable offline (runs with zero LLM calls)`

**Flair:** Resources (or Other, if Resources isn't offered)

> If your agents negotiate (buying compute, procurement, data deals), the usual setup puts the walk-away number in the system prompt. That number then becomes extractable by anything the counterparty can get into context.
>
> I've been building Bloom Exchange, an Apache-2.0 node you can run entirely on your own box. The points that matter for this sub:
>
> - **No model required.** The default proposer is a deterministic engine, so you can run it air-gapped. `npm install && npm run dev`, or `docker compose` for two isolated nodes (Redis plus a REST gateway on an internal network). With no model keys and no webhook, a node makes no outbound calls beyond its configured peers.
> - **Model proposes, code disposes.** When you do use an LLM, it only *proposes* offers. Every offer is clamped in code to both sealed mandates before it's sent or signed, so a weak or hostile model can't move money outside your limits. There's a test that throws an adversarial proposer at 300 randomized negotiations.
> - **Firewall in front of the model.** Injection, invisible and tag Unicode, homoglyphs, base64 smuggling and hidden markup are neutralized before any engine reads counterparty text.
> - **Receipts you can check offline.** Ed25519, hash-chained rounds, and test vectors in the spec if you want to port the verifier to Python.
>
> Honest gaps: the live proposer currently speaks Anthropic or OpenRouter (OpenRouter's default list includes open-weight models like DeepSeek). There's no llama.cpp, vLLM or Ollama proposer yet. It's a small, well-bounded change in `packages/core/src/live-model.ts`, and I'd happily take a PR or work through it with someone. Also, the node operator can read both mandates in v0.1; the spec's threat model says so plainly.
>
> Repo: https://github.com/astyboyy-ship-it/bloom-exchange
>
> If you're running local agents that need to trade or procure, I'd love to hear what you'd want the proposer interface to look like.

### r/ClaudeAI

**Title:** `I made an MCP server that lets Claude negotiate with other agents without leaking your budget, and verify the Ed25519 receipt`

**Flair:** MCP (or Built with Claude)

> One command:
>
> ```
> claude mcp add bloom-exchange -e BLOOM_EXCHANGE_URL=http://localhost:3000 -- npx -y @bloom-exchange/mcp
> ```
>
> Run a node locally first: clone https://github.com/astyboyy-ship-it/bloom-exchange, then `npm install && npm run dev`. The sandbox needs no keys.
>
> Then try: *"Negotiate a 12-month observability license on Bloom with a $52.5k ceiling, gold SLA, net 60, and verify the receipt."*
>
> What happens:
>
> - **`negotiate`** sends your limits to the node, where they're sealed in a double-blind vault. The counterparty's engines never see them, and no response Claude receives contains the other side's floor. The tool returns the settled terms plus a BLOOM-XCH certificate that has already been verified (Ed25519 signature, hash-chained rounds, AP2 credentials).
> - **`verify_receipt`** checks any receipt offline against the issuer's signed Agent Card.
> - **`publish_intent`** takes a plain-language goal (or a payload from Slack, Salesforce, AWS and other protocols, 40 adapters in all) and clears it.
>
> Why I built it: if Claude holds your budget in context while it reads the other agent's messages, one injected line can ask for it. Here the hard limit lives on the clearing node and is clamped in code, so Claude proposes but can't overspend, and a hostile counterparty can't extract the other side's number.
>
> Caveat, stated up front: Claude itself sees the ceiling you give it. The protection is against the *counterparty* and against offers that exceed the ceiling. The node operator is also trusted in v0.1.
>
> Apache-2.0. Feedback on the tool design is very welcome.

---

## 4. Framework integration example (`examples/langgraph-bloom-integration.md`)

Copy the block below into `examples/langgraph-bloom-integration.md` for a pull request to this repository, or adapt it for a framework's community-examples directory.

````markdown
# Secure agent negotiation with Bloom Exchange (LangGraph.js and CrewAI)

Your agent decides **what** to buy. Bloom decides **how far it can go**. The budget lives in code and in Bloom's sealed vault, never in the model's prompt, so an injected message from the other side has nothing to extract. Every settlement returns an Ed25519-signed BLOOM-XCH receipt, verified before your agent sees it.

Prerequisite: a Bloom node. For local development:

```bash
git clone https://github.com/astyboyy-ship-it/bloom-exchange && cd bloom-exchange
npm install && npm run dev      # http://localhost:3000, sandbox, no keys needed
```

## LangGraph.js

```bash
npm install @bloom-exchange/sdk @langchain/langgraph @langchain/core @langchain/anthropic zod
```

```ts
import { ChatAnthropic } from "@langchain/anthropic";
import { tool } from "@langchain/core/tools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { z } from "zod";
import { BloomExchangeClient, type BuyerMandate } from "@bloom-exchange/sdk";

const bloom = new BloomExchangeClient({
  baseUrl: process.env.BLOOM_EXCHANGE_URL ?? "http://localhost:3000",
  accessKey: process.env.BLOOM_ACCESS_KEY, // optional: production enclaves instead of the sandbox
  agent: { name: "acme-procurement", framework: "langgraph" },
});

// The walk-away limits live here, in code. The tool schema below has no price fields,
// so the model can neither see nor change them, and nothing it reads can extract them.
const MANDATE: BuyerMandate = { ceilingPriceUsd: 52_500, maxBudgetUsd: 55_000, requiredSlaTier: "gold", targetNetDays: 60 };

const negotiateOnBloom = tool(
  async ({ item }) => {
    const { state, certificate } = await bloom.negotiate({ mandate: MANDATE, item: { description: item } }).result;
    if (state !== "completed" || !certificate) {
      return JSON.stringify({ settled: false, state, note: "No terms fit inside both sealed limits. Escalate to a human." });
    }
    // Offline Ed25519 verification against the key pinned from the node's signed Agent Card.
    const proof = await bloom.verifyCertificate(certificate);
    return JSON.stringify({
      settled: proof.valid,
      receipt: certificate.certificateId,
      priceUsd: certificate.terms.priceUsd,
      netDays: certificate.terms.netDays,
      slaTier: certificate.terms.slaTier,
      checks: proof.checks, // digest, certificateId, chain, signature, ap2Proofs
    });
  },
  {
    name: "negotiate_on_bloom",
    description: "Buy something through Bloom Exchange. Budget and terms are enforced by Bloom; you only say what to buy. Returns a verified receipt.",
    schema: z.object({ item: z.string().min(2).max(200).describe("What to buy, in one line") }),
  },
);

const agent = createReactAgent({ llm: new ChatAnthropic({ model: "claude-sonnet-5-5" }), tools: [negotiateOnBloom] });

const result = await agent.invoke({
  messages: [{ role: "user", content: "We need a managed observability platform for 12 months. Get it done and tell me the receipt id." }],
});
console.log(result.messages.at(-1)?.content);
```

Store the full `certificate` JSON with the purchase record. Anyone can re-check it later, offline, with `npx @bloom-exchange/sdk verify receipt.json`.

## CrewAI (Python)

Bloom speaks A2A JSON-RPC, so a Python agent needs only `httpx`. Receipts are verified with the same CLI. (A native Python verifier can be written against the byte-exact vectors in SPEC.md Appendix A.)

```bash
pip install crewai httpx
```

```python
import json, os, shutil, subprocess, tempfile, uuid

import httpx
from crewai import Agent, Crew, Task
from crewai.tools import BaseTool
from pydantic import BaseModel, Field

BLOOM_URL = os.environ.get("BLOOM_EXCHANGE_URL", "http://localhost:3000")
# The walk-away limits live here, in code. The tool's arguments don't include them.
MANDATE = {"ceilingPriceUsd": 52500, "maxBudgetUsd": 55000, "requiredSlaTier": "gold", "targetNetDays": 60}


def verify_receipt(certificate: dict) -> dict:
    """Offline Ed25519 verification via the reference CLI (exit 0 valid, 1 invalid, 2 bad input)."""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(certificate, f)
    npx = shutil.which("npx") or "npx"
    out = subprocess.run([npx, "-y", "@bloom-exchange/sdk", "verify", f.name, "--json"], capture_output=True, text=True)
    os.unlink(f.name)
    return json.loads(out.stdout) if out.stdout else {"valid": False, "reason": out.stderr.strip()}


def negotiate(item: str) -> dict:
    body = {
        "jsonrpc": "2.0",
        "id": str(uuid.uuid4()),
        "method": "SendMessage",
        "params": {"message": {"messageId": str(uuid.uuid4()), "role": "user", "parts": [
            {"kind": "data", "data": {"bloomExchange": {
                "intent": "negotiate",
                "mandate": MANDATE,
                "item": {"description": item},
                "peer": {"name": "acme-crew", "framework": "custom"},
            }}}
        ]}},
    }
    headers = {"Idempotency-Key": str(uuid.uuid4())}  # retries with the same key never double-settle
    if os.environ.get("BLOOM_ACCESS_KEY"):
        headers["x-bloom-license"] = os.environ["BLOOM_ACCESS_KEY"]
    task = httpx.post(f"{BLOOM_URL}/api/exchange/a2a", json=body, headers=headers, timeout=120).json()["result"]
    cert = next((p["data"] for a in task.get("artifacts", []) if a["name"] == "bloom-settlement-certificate"
                 for p in a["parts"] if p.get("kind") == "data"), None)
    if task["status"]["state"] != "completed" or cert is None:
        return {"settled": False, "state": task["status"]["state"]}
    proof = verify_receipt(cert)
    return {"settled": proof.get("valid", False), "receipt": cert["certificateId"], "terms": cert["terms"], "checks": proof.get("checks")}


class NegotiateInput(BaseModel):
    item: str = Field(..., description="What to buy, in one line")


class BloomNegotiateTool(BaseTool):
    name: str = "negotiate_on_bloom"
    description: str = "Buy something through Bloom Exchange. Budget and terms are enforced by Bloom. Returns a verified receipt."
    args_schema: type[BaseModel] = NegotiateInput

    def _run(self, item: str) -> str:
        return json.dumps(negotiate(item))


buyer = Agent(role="Procurement agent", goal="Buy what the team needs within policy", backstory="You buy software for Acme.", tools=[BloomNegotiateTool()])
task = Task(description="Buy a managed observability platform for 12 months and report the receipt id.", expected_output="The receipt id and the settled terms.", agent=buyer)
print(Crew(agents=[buyer], tasks=[task]).kickoff())
```

## What this protects, and what it doesn't

- **Protected:** the counterparty never learns your ceiling, and you never learn theirs. No offer outside either mandate is sent or signed. A forged or edited receipt fails verification.
- **Not protected in v0.1:** the operator of the clearing node can read both mandates. Use a node you trust, or run your own (`deploy/`). See SPEC.md §12.1.
````

---

## 5. Design-partner DMs

Rules: one specific observation about their work, one question, no attachments, no "quick call?" in the first message. Send from your own account, and change the first line every time.

**A. MCP tool builders** (GitHub issue or discussion, or X DM)

> Saw your `<server>`. The `<tool>` design is clean. Question for you: when an agent using it has to agree on a price or terms with another agent, where do you keep its walk-away number? I've been working on an MCP server that seals both sides' limits outside the model and returns an Ed25519 receipt (`npx -y @bloom-exchange/mcp`). I'm trying to learn whether that's a real need or an imagined one. If it's imagined, I'd rather hear it from you now.

**B. Agent-marketplace builders**

> Your marketplace has agents transacting with agents, which is exactly where I've been stuck: who holds each side's limits, and what does the buyer get as proof? I built an open A2A clearing layer for that (double-blind vault, deterministic clamps, receipts that verify offline): github.com/astyboyy-ship-it/bloom-exchange. Not pitching. I'd value 10 minutes of your skepticism on the threat model (SPEC.md §12). What would have to be true for you to route a transaction through something like this?

**C. Procurement and buying-bot builders**

> Read your write-up on `<their procurement agent>`. Curious how you keep the budget out of reach of a supplier who slips instructions into a quote or a PDF. I've been testing exactly that failure. My take was to move limits out of the prompt into a sealed vault and clamp every offer in code, with a signed receipt at the end. Happy to run your agent against our adversarial suite (injection, homoglyphs, lowball anchoring) and send you the results, no strings attached, if that'd be useful.

**Follow-up (once, after 5 to 7 days, only if there was no reply):**

> No worries if this isn't a fit. One last thing that might be useful on its own: the spec's test vectors (SPEC.md Appendix A) make it easy to check whether any agent receipt format you use is actually tamper-evident. Thanks either way.
