# Bloom events: wake-ups, polling and post-settlement adapters

A node can publish a typed, redacted feed of what its enclaves do. Agents and harnesses wake on it, poll it by cursor, or hand it to adapters that act after a deal settles. **It is off by default** and changes nothing about negotiation, clamping or receipts when on.

```bash
BLOOM_EVENTS=1 npm run dev
curl -s "http://localhost:3000/api/exchange/events?taskId=xch_…"         # a task id from SendMessage or the SDK
curl -s "http://localhost:3000/api/exchange/events" -H "x-bloom-license: $OPERATOR_KEY"   # the whole node
```

## What an event carries, and what it never carries

| Event | `data` |
|---|---|
| `negotiation.opened` | `framework`, `source` |
| `firewall.scanned` | `verdict`, and a count per threat vector |
| `offer.updated` | `round`, `by`, `priceUsd`, `netDays`, `slaTier`, `hash`, `prevHash` |
| `negotiation.clamped` | `round`, and the **names** of the rules Sovereign applied |
| `negotiation.exception` | `kind` (`out_of_bounds`, `above_auto_settle`, `sla_infeasible`, `resource_bounds`) |
| `negotiation.settled` | `certificateId`, `priceUsd`, `netDays`, `slaTier`, `rounds`, `binding` |
| `receipt.issued` | `certificateId`, `digest`, `kid`, `issuerCard`, `chainHead`, `binding` |
| `negotiation.closed` | `state` (`failed` or `canceled`) |

Every event also has `id`, `seq`, `cursor`, `at`, `taskId`, `contextId`, `environment` and `audience` (`public` or `operator`).

Events are built field by field from the enclave record (`packages/core/src/events/project.ts`), never by copying an internal event. That keeps out:

* any mandate figure: floor, ceiling, budget, cost basis, margin, auto-settle limit;
* the values a clamp moved an offer from and to, since those would place the floor;
* exception detail text, which names the floor and the gap;
* every kind of free text: model messages, item descriptions, peer names, and the text that matched a firewall rule.

Offer prices are included because both parties already see every offer, and guard bands keep every offer off every private limit. The test suite sweeps the feed and every adapter's output for each private figure in each spelling (`packages/core/test/events.test.ts`).

## Push and poll

| | How |
|---|---|
| In process | `enableEvents()` then `hub.subscribe(listener, types?)` |
| Poll (any harness) | `GET /api/exchange/events?cursor=<c>&limit=50&types=receipt.issued` returns `{ events, cursor, reset, hasMore }` |
| Push (SSE) | `GET /api/exchange/events?stream=1`. It replays from `cursor` or `Last-Event-ID`, then streams live for up to 100 s. Each frame's `id:` is its cursor. |
| MCP | the `poll_events` tool on every transport. The `bloom://events` resource is subscribable over stdio, which sends `notifications/resources/updated` when new events arrive. |

**Cursors** are opaque (`<epoch>.<seq>`). Always resume from the returned cursor. It advances past events a filter skipped, so a poller never re-scans them. `reset: true` means the cursor can't resume exactly, and the page starts from the oldest retained event. That happens when the cursor is from before a restart of a memory log, from another node, or older than the retained window.

**Scope** mirrors `GetTask`:

| Reader | Sees |
|---|---|
| Operator access key | Every event |
| Any other access key | Events of its own tasks (owner from the key) |
| Anyone | Events of the sandbox tasks whose ids it presents (`&taskId=xch_…`, up to 100), as `GetTask` accepts them |

Operator-side events (`negotiation.clamped`, `negotiation.exception`) reach non-operators only for sandbox tasks. Every event has an `audience` field to make this visible. The MCP server presents the ids of the negotiations it opened, so `poll_events` works without a key.

* **Why not "sandbox events for anyone":** the feed would list task ids. A sandbox task id is a capability elsewhere: it unlocks `GetTask`, resume, cancel and the sandbox operator stream, which carries that sandbox's provider figures. The feed never hands out an id the caller didn't already hold.
* **Why not "your own anonymous tasks":** an anonymous identity is a client IP, and one host can reach a node as `127.0.0.1`, `::1` or `::ffff:127.0.0.1`, while a shared NAT merges many callers into one. That's too weak to grant anything on its own.
* **Why clamps stay operator-side:** "round 4 was clamped to `mandate_floor`", next to round 4's offer, places the provider's floor within its guard band. The A2A stream keeps the same facts operator-only.
* **Known limits:**
  * Ownership is held in memory, so after a restart a key holder's feed covers only tasks created since. Presenting task ids still works for sandbox tasks.
  * Sequence numbers are per node, so a reader sees gaps where other callers' events were. That reveals how busy the node is, never anything about a mandate.

## Adapters

| Adapter | Status | Notes |
|---|---|---|
| `WebhookAdapter` | Built | See the guardrails below |
| `JsonlSinkAdapter` | Built | Appends `{deliveredAt, event}` lines to a local file. `receipt.issued` lines are enough to fetch and verify the receipt with `npx @bloom-exchange/sdk verify`. |
| `MockTriggerAdapter` | Built | Dry run. It records what a post-settlement hook would have fired on and sends nothing. |
| Payment-rail triggers on events | Planned | The existing settlement webhook (`BLOOM_EXCHANGE_SETTLEMENT_WEBHOOK_URL`) is unchanged and separate |
| `bloom.exchange/<agent>` link callbacks | Planned | Links are a naming format today, with no resolver |
| Shared log across node instances | Planned | Today each process keeps its own log. One process per `BLOOM_EVENTS_DIR`: two writers would duplicate sequence numbers. The file log appends synchronously and grows until rotated by hand. |
| Third-party integrations | Not built | None exist |

**Webhook guardrails:**

* **Allowlist:** exact origins only (scheme, host and port) are allowed.
* **Scheme:** https only, except plain http to a loopback host for local development.
* **No credentials** in the URL.
* **Address checks:** every address the host resolves to must be public, so a name that resolves, or rebinds, to a private, link-local, metadata or NAT64 address is refused. A loopback host must resolve to loopback.
* **Pinned connection:** the request connects to the checked address itself, with no second lookup and therefore no rebinding window.
* **No redirects:** a redirect is never followed, and counts as a failure that isn't retried.
* **Limits:** one 4-second deadline covers DNS and the request together, and the body is capped at 64 KiB. Each delivery uses its own socket, with no pooling.
* **Status code only:** the response body is never read, parsed or logged.
* **Signing:** with a secret, `Bloom-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`. Receivers can check it with `verifyEventSignature()`.

**Delivery** runs after the event is logged and can never fail a negotiation:

* **Ordering:** each adapter has its own serial queue, so it receives events in log order, one delivery at a time. A slow adapter never delays another. Past 1000 waiting events, new ones are dead-lettered instead of buffered without bound.
* **Dispatched once:** an (adapter, event) pair is dispatched once per process; re-dispatching it is a no-op.
* **But possibly received twice:** one dispatch can still reach a receiver twice, for example when it times out after the receiver processed it and is then retried. `Idempotency-Key` is the event id, so receivers should deduplicate on it, which also covers restarts.
* **Retries:** retryable failures (5xx, 429, timeouts, connection errors) are retried with exponential backoff, 3 attempts by default.
* **Dead letters:** everything else, and deliveries that exhaust their retries, goes to a bounded dead-letter list (`hub.registry.deadLetters()`; the operator's feed response reports the count).
* **Misconfiguration:** an adapter refused at startup (for example a webhook with no allowlist) is reported on stderr and in the operator's feed response under `disabled`. It is never dropped silently.

Anything an adapter reads back is data, never instructions: nothing it returns can reach a negotiation, a mandate or a clamp.

## Configuration

| Variable | Effect |
|---|---|
| `BLOOM_EVENTS=1` | Turn the feed on (memory log) |
| `BLOOM_EVENTS_DIR=./data/events` | Durable local log; cursors survive restarts |
| `BLOOM_EVENTS_JSONL=./data/audit.jsonl` | Add the JSONL audit sink |
| `BLOOM_EVENTS_WEBHOOK_URL` | Add the webhook adapter. It needs `BLOOM_EVENTS_WEBHOOK_ALLOW`; without it the adapter stays off. |
| `BLOOM_EVENTS_WEBHOOK_ALLOW` | Comma-separated exact origins, e.g. `https://hooks.example.com` |
| `BLOOM_EVENTS_WEBHOOK_SECRET` | HMAC secret for `Bloom-Signature` |

In code:

```ts
import { enableEvents, JsonlSinkAdapter, MockTriggerAdapter, WebhookAdapter } from "@bloom-exchange/core/events";

const hub = enableEvents({
  adapters: [
    new JsonlSinkAdapter({ path: "./data/audit.jsonl" }),
    new WebhookAdapter({ url: "https://hooks.example.com/bloom", allow: ["https://hooks.example.com"], secret: process.env.HOOK_SECRET, events: ["receipt.issued"] }),
    new MockTriggerAdapter(),
  ],
});
hub.subscribe((e) => console.log(e.type, e.taskId), ["negotiation.settled"]);
```
