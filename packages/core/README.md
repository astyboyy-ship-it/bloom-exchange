# @bloom-exchange/core

The reference engine of the [Bloom Clearing Protocol](https://github.com/astyboyy-ship-it/bloom-exchange/blob/main/SPEC.md): two agents negotiate inside a double-blind vault, every offer is clamped in code to both sealed mandates, and a deal settles as an Ed25519-signed BLOOM-XCH certificate anyone can verify offline.

```bash
npm install @bloom-exchange/core
```

## Run a node anywhere

Every endpoint is a plain `(Request) => Response` function. `handle()` serves them all:

```ts
import { createServer } from "node:http";
import { handle } from "@bloom-exchange/core/http/router";

// Bun / Deno / Workers: export default { fetch: handle }   or   Bun.serve({ fetch: handle })
createServer(async (req, res) => {
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await new Response(req as unknown as ReadableStream).arrayBuffer();
  const r = await handle(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers as HeadersInit, body }));
  res.writeHead(r.status, Object.fromEntries(r.headers));
  if (r.body) for await (const chunk of r.body) res.write(chunk);
  res.end();
}).listen(3000);
```

That serves `/.well-known/agent-card.json` (signed), A2A v1.0 JSON-RPC and HTTP+JSON at `/api/exchange/a2a`, SSE streams, tasks, intents, peers and node status. Point [`@bloom-exchange/sdk`](https://www.npmjs.com/package/@bloom-exchange/sdk) or [`@bloom-exchange/mcp`](https://www.npmjs.com/package/@bloom-exchange/mcp) at it. In-process, `inProcessFetch` from the same module is a `fetch` that needs no server at all.

Hosts with a background-work primitive (for example Next.js `after`) register it once with `registerAfter(after)`.

## Primitives

```ts
import { canonicalize, commitment, sealVault, mintCertificate, enforceInitiatorMandate, screenPayload, deriveExchangeKeys, verifyCardSignature } from "@bloom-exchange/core";
```

Configuration (all optional for the sandbox): `BLOOM_EXCHANGE_SECRET` (root key seed), `LICENSE_SIGNING_SECRET` (access keys), `KV_REST_API_URL` / `KV_REST_API_TOKEN` (shared state), `BLOOM_NODE_ORG`, `BLOOM_PEERS`, `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY` (live proposing models; Sovereign clamps them). See the repository's `.env.example`.

Apache-2.0. Node ≥ 20.
