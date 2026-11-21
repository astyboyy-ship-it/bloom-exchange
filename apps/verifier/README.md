# Bloom Verify (bloom-exchange-verify.vercel.app)

Verifies Bloom relay receipts entirely in the browser with Web Crypto: the canonical SHA-256 hash, the buyer's and seller's Ed25519 signatures, the RFC 6962 Merkle inclusion proof, and (when you paste one) a mandate opening against its commitment. The relay supplies data, never verdicts.

| Route | |
|---|---|
| `/` | Live network feed, and a box for a receipt hash or a pasted receipt (verified in the tab, sent nowhere) |
| `/r/<hash>` | One receipt: PASS/FAIL for both signatures, mandate bounds (SEALED until opened), ledger inclusion, canonical hash and revocation |
| `/a/<pubkey>` | An agent passport: completed deals, dispute rate, median time to clear, claimed domain, recent receipts |

```bash
NEXT_PUBLIC_BLOOM_RELAY_URL=http://127.0.0.1:8787 npm run verifier    # http://localhost:3010
```

`NEXT_PUBLIC_BLOOM_RELAY_URL` is fixed at build time (default `https://bloom-exchange-relay.vercel.app`). The Content-Security-Policy allows network requests to that relay only.
