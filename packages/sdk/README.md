# @bloom-exchange/sdk

Connect any AI agent to **Bloom Exchange**, the autonomous inter-agent clearinghouse. Your agent deposits a sealed buying mandate, Bloom negotiates it against a provider's standing mandate inside a double-blind enclave, and you get back a signed `BLOOM-XCH-…` settlement certificate that maps to AP2 checkout and payment mandates and carries Stripe and x402 (USDC) settlement payloads.

- **Zero dependencies.** Runs on Node 20+, Deno, Bun, and modern browsers. Uses `fetch` and Web Crypto only.
- **A2A v1.0.** It discovers `/.well-known/agent-card.json`, checks the card's signature, then speaks JSON-RPC 2.0 (`SendStreamingMessage`, `GetTask`, `CancelTask`).
- **Your limits stay private.** The provider's engines never see your ceiling or budget, and no response to you ever contains the provider's floor.
- **Verified offline.** Certificates are checked locally against the Ed25519 key pinned from the Agent Card.

```bash
npm install @bloom-exchange/sdk
```

## Verify a receipt from the command line

```bash
npx @bloom-exchange/sdk verify receipt.json                    # keys from the issuer's Agent Card
npx @bloom-exchange/sdk verify receipt.json --card card.json   # fully offline, air-gapped
npx @bloom-exchange/sdk verify receipt.json --json             # machine-readable; exit 0 valid · 1 invalid · 2 bad input
```

Accepts a bare certificate or any JSON containing one under `certificate`. Once installed the command is `bloom-verify`. It checks the canonical digest, certificate id, round hash chain, Ed25519 signature, both AP2 proofs, and that the Agent Card supplying the keys verifies against itself.

## Five lines

```ts
import { BloomExchangeClient } from "@bloom-exchange/sdk";

const bloom = new BloomExchangeClient({ baseUrl: "https://your-bloom.app", accessKey: process.env.BLOOM_ACCESS_KEY });
const run = bloom.negotiate({ mandate: { ceilingPriceUsd: 52_000, maxBudgetUsd: 55_000, requiredSlaTier: "gold", targetNetDays: 45 }, item: { description: "12-month platform license" } });
const { certificate } = await run.result;
console.log(certificate?.certificateId, await bloom.verifyCertificate(certificate!));
```

Without an `accessKey`, negotiations run in a **sandbox enclave**: deterministic simulation, full protocol fidelity, non-binding certificates on `base-sepolia`. With a Bloom access key you negotiate against the provider's live standing mandate, and certificates are binding.

## Clearing macro resources

Enclaves clear more than price. Add a `resources` block to your mandate to reserve compute, energy, capital, compliance attestations or bandwidth in the same negotiation:

```ts
const run = bloom.negotiate({
  mandate: {
    ceilingPriceUsd: 68_000, maxBudgetUsd: 72_000, requiredSlaTier: "gold", targetNetDays: 30,
    resources: {
      computeUnits:  { quantity: 90_000, minQuantity: 60_000 },
      energyKwh:     { quantity: 30_000 },
      bandwidthGbps: { quantity: 25, minQuantity: 10 },
    },
  },
  item: { description: "Q1 inference capacity" },
  paymentRail: "x402",
});
const { certificate } = await run.result;
certificate?.resources?.allocation; // { computeUnits: 90000, energyKwh: 30000, bandwidthGbps: 25 }
```

| Dimension | Unit |
| --- | --- |
| `computeUnits` | CU |
| `energyKwh` | kWh |
| `capitalUsd` | USD |
| `complianceToken` | tokens |
| `bandwidthGbps` | Gbps |

Bloom's Sovereign engine allocates before any offer is made. You get `min(quantity, provider capacity)` per dimension. If that falls below your `minQuantity` (default: the full `quantity`), or the provider doesn't offer the dimension, the task ends in `input_required`, and you can `resume()` with a smaller request. The allocated resources set a price floor (the provider's unit floor × quantity), so the settled price always covers them. The certificate carries one proof per dimension: requested, granted, whether it was clamped to capacity, and a salted commitment to the provider's unit floor. The digest and Ed25519 signature cover all of it.

## Streaming rounds

```ts
const run = bloom.negotiate({ mandate, item, message: "Gold SLA required; we prefer net 60." });
for await (const e of run) {
  if (e.type === "firewall") console.log("shield:", e.verdict);
  if (e.type === "round") console.log(e.round.n, e.round.by, e.round.terms.priceUsd);
  if (e.type === "settled") console.log("settled:", e.certificate.certificateId);
}
const { state, task, certificate } = await run.result;
```

| Event      | Meaning                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------- |
| `task`     | Enclave provisioned. `task.id` is your handle.                                              |
| `firewall` | Shield's verdict on your payload: `clean`, `neutralized`, or `quarantined`.                 |
| `round`    | One offer, hash-chained (`prevHash` → `hash`).                                              |
| `state`    | Lifecycle: `submitted` → `working` → `input_required` / `completed` / `failed` / `canceled`. |
| `settled`  | The signed certificate.                                                                     |
| `final`    | The stream's last state.                                                                    |

## When Bloom asks for input

If your final counter sits outside the provider's mandate, the task ends in `input_required` with `task.metadata["bloom.awaiting"] === "revised_mandate_or_executive"`. Bloom does not tell you by how much. You can send a revised mandate, which continues the same hash chain, or wait for the provider's executive to accept or reject:

```ts
const resumed = bloom.resume(task.id, { ...mandate, ceilingPriceUsd: 55_000 });
const outcome = await resumed.result;
```

## Idempotency

Every `negotiate()` call sends an `Idempotency-Key` (pass your own as `idempotencyKey`). Network retries reuse it, so a retried request returns the original task and can never settle twice. Reusing a key with a different payload is rejected with error `-32050`.

## Verifying a certificate

```ts
const result = await bloom.verifyCertificate(certificate);
// { valid: true, checks: { digest, certificateId, chain, signature, ap2Proofs } }
```

| Check           | What is recomputed                                                                       |
| --------------- | ---------------------------------------------------------------------------------------- |
| `digest`        | SHA-256 of the canonical certificate body.                                               |
| `certificateId` | `BLOOM-XCH-…` derived from task id, chain head and issue time.                           |
| `chain`         | Every round hash, and each round's link to the previous one.                             |
| `signature`     | Ed25519 over the digest, using the key the Agent Card publishes (`kid` pinned).          |
| `ap2Proofs`     | The Data Integrity proofs on the AP2 checkout and payment mandate credentials.           |

Each certificate also carries salted SHA-256 **mandate commitments** for both parties. They bind each side to the mandate it deposited without revealing it, and can be opened later in a dispute by revealing the mandate and its salt.

## Mandate fields

| Field             | Meaning                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `ceilingPriceUsd` | Highest total contract price you will accept.                      |
| `maxBudgetUsd`    | Hard budget cap. The effective ceiling is the lower of the two.    |
| `requiredSlaTier` | `bronze`, `silver`, `gold` or `platinum`. Minimum you accept.      |
| `targetNetDays`   | Payment terms you'd like. A soft preference.                       |
| `openingPriceUsd` | Optional first offer. Defaults to 70% of your reserve.             |

## Example agent

[`examples/external-buyer-agent.ts`](examples/external-buyer-agent.ts) is a complete procurement agent. It derives its mandate from a brief, optionally drafts its opening note with OpenAI, streams the negotiation, decides on its own whether to resume after an escalation, and verifies the certificate.

```bash
node examples/external-buyer-agent.ts                                   # local sandbox
BLOOM_EXCHANGE_URL=https://your-bloom.app BLOOM_ACCESS_KEY=BLOOMK-… node examples/external-buyer-agent.ts
```

## Security notes

- Every text field you send, including your Agent Card's skills, passes Bloom's firewall. Hidden instructions, role tokens, invisible Unicode, and base64 payloads are stripped and logged. A critical finding quarantines your message, and only your structured mandate is used.
- Repeated out-of-bounds negotiations from one identity are treated as mandate probing and lower your trust score.
- Calls are rate-limited per identity. Live model execution on the provider's side is capped by the provider's spend limits.
