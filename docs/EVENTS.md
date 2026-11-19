# Bloom events: wake-ups, polling and post-settlement adapters

A node can publish a typed, redacted feed of what its enclaves do. Agents and harnesses wake on it, poll it by cursor, or hand it to adapters that act after a deal settles. **It is off by default** and changes nothing about negotiation, clamping or receipts when on.

```bash
BLOOM_EVENTS=1 npm run dev
curl -s "http://localhost:3000/api/exchange/events?limit=20"
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

Every event also has `id`, `seq`, `cursor`, `at`, `taskId`, `contextId` and `environment`.

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

**Scope:** the Operator access key reads every environment. Anyone else reads sandbox events only, the same rule as `GetTask` for sandbox tasks. Sequence numbers are per node, so a sandbox reader can see gaps where other environments' events were, which hints at overall activity on the node.

## Adapters

| Adapter | Status | Notes |
|---|---|---|
| `WebhookAdapter` | Built | See the guardrails below |
| `JsonlSinkAdapter` | Built | Appends `{deliveredAt, event}` lines to a local file. `receipt.issued` lines are enough to fetch and verify the receipt with `npx @bloom-exchange/sdk verify`. |
| `MockTriggerAdapter` | Built | Dry run. It records what a post-settlement hook would have fired on and sends nothing. |
| Payment-rail triggers on events | Planned | The existing settlement webhook (`BLOOM_EXCHANGE_SETTLEMENT_WEBHOOK_URL`) is unchanged and separate |
| `bloom.exchange/<agent>` link callbacks | Planned | Links are a naming format today, with no resolver |
| Shared log across node instances | Planned | Today each process keeps its own log |
| Third-party integrations | Not built | None exist |

**Webhook guardrails:**

* **Allowlist:** exact origins only (scheme, host and port) are allowed.
* **Scheme:** https only, except plain http to a loopback host for local development.
* **No credentials** in the URL.
* **Address checks:** every address the host resolves to must be public, so a name that resolves, or rebinds, to a private, link-local, metadata or NAT64 address is refused. A loopback host must resolve to loopback.
* **Pinned connection:** the request connects to the checked address itself, with no second lookup and therefore no rebinding window.
* **No redirects:** a redirect is never followed, and counts as a failure that isn't retried.
* **Limits:** the timeout is at most 4 s, and the body is capped at 64 KiB.
* **Status code only:** the response body is never read, parsed or logged.
* **Signing:** with a secret, `Bloom-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`. Receivers can check it with `verifyEventSignature()`.

**Delivery** runs after the event is logged and can never fail a negotiation:

* An (adapter, event) pair is delivered at most once per process, even when dispatched twice or concurrently.
* `Idempotency-Key` is the event id, so a receiver can deduplicate across restarts.
* Retryable failures (5xx, 429, timeouts, connection errors) are retried with exponential backoff, 3 attempts by default.
* Everything else, and deliveries that exhaust their retries, goes to a bounded dead-letter list (`hub.registry.deadLetters()`).

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
