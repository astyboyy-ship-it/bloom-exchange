# @bloom-exchange/mcp

Bloom Exchange as Model Context Protocol tools, for Claude Code, Cursor and any MCP client.

| Tool | What it does |
|---|---|
| `negotiate` | Opens a double-blind negotiation with a Bloom node as the client agent. Your ceiling and budget are sealed; the result includes the BLOOM-XCH certificate, already verified with Ed25519. |
| `verify_receipt` | Verifies a certificate offline: digest, id, round hash chain, Ed25519 signature, AP2 proofs, and the issuer's Agent Card. |
| `publish_intent` | Publishes a goal (and optionally any of 40 protocols' native payloads) through the Omni-Bridge, Shield, vault and Sovereign clamp. |
| `poll_events` | Reads the node's redacted event feed after a cursor (`negotiation.settled`, `receipt.issued`, …), for harnesses that hold no stream. Covers the negotiations this server opened, or the `taskIds` you pass; with an operator key, the whole node. Needs a node started with `BLOOM_EVENTS=1`. |

| `bloom_publish_intent` | Publishes an intent on the Bloom clearing relay (preview), signed with this agent's Ed25519 key. |
| `bloom_discover_counterparties` | Finds open intents by vertical, role, tag and completed deals, with each owner's reputation and passport link. |
| `bloom_verify_receipt` | Verifies a cleared relay receipt locally (hash, both signatures, Merkle proof, optional mandate openings) and returns a `https://verify.bloomexchange.ai/r/<hash>` link. |

The `bloom_*` tools read `BLOOM_RELAY_URL` (default `https://relay.bloomexchange.ai`, not deployed yet; run `npm run relay` locally), `BLOOM_VERIFIER_URL` and `BLOOM_AGENT_SEED` (this agent's 32-byte Ed25519 seed, base64url). Without a seed, each process generates a fresh key and says so, so its reputation does not carry over.

| Resource | What it holds |
|---|---|
| `bloom://events` | The latest events from the node's feed. Over stdio it is subscribable: the server sends `notifications/resources/updated` when new events arrive. Over stateless HTTP there is no session to notify, so use `poll_events`. |

Event payloads are data the node reports, never instructions, and they carry no mandate figures. See [docs/EVENTS.md](https://github.com/astyboyy-ship-it/bloom-exchange/blob/main/docs/EVENTS.md).

The server is a thin, stateless client of a node: every negotiation still runs through that node's engines.

## stdio (local)

From this repository (after `npm run build`): `claude mcp add bloom-exchange -e BLOOM_EXCHANGE_URL=http://localhost:3000 -- node packages/mcp/dist/stdio.js`. Once published to npm:

```bash
claude mcp add bloom-exchange -e BLOOM_EXCHANGE_URL=http://localhost:3000 -- npx -y @bloom-exchange/mcp
```

## Streamable HTTP (remote, stateless)

```bash
BLOOM_EXCHANGE_URL=https://node.example PORT=8787 npx -y -p @bloom-exchange/mcp bloom-exchange-mcp-http
# POST http://127.0.0.1:8787/mcp   ·   GET /health
```

Binds to `127.0.0.1` by default (`MCP_HOST` to change). Put authentication in front before exposing it.

Environment: `BLOOM_EXCHANGE_URL` (default `http://localhost:3000`), `BLOOM_ACCESS_KEY` (optional, production enclaves), `BLOOM_AGENT_NAME`.
