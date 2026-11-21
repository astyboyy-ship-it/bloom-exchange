# @bloom-exchange/schemas

Commercial term schemas for the Bloom clearing relay, as zero-dependency runtime validators and TypeScript types.

| Vertical | Fields | Negotiated price |
|---|---|---|
| `api.inference` | `model`, `maxInputTokens`, `maxOutputTokens`, `latencySlaMs`, `unitPriceAtomic` (per 1,000 tokens), `currency` | `unitPriceAtomic` |
| `compute.gpu` | `accelerator`, `acceleratorCount`, `vramGb`, `durationSeconds`, `containerDigest` (`sha256:…`), `totalPriceAtomic`, `currency` | `totalPriceAtomic` |
| `data.retrieval` | `datasetId`, `queryHashSha256`, `maxAgeSeconds`, `licenseTier`, `totalPriceAtomic`, `currency` | `totalPriceAtomic` |

Validation is strict: unknown keys are rejected, so a valid value has exactly one canonical JSON form and can be hashed and signed as-is. Prices are **atomic**: a decimal integer string counting the currency's smallest unit (USD: cents, USDC: 10⁻⁶), never a float.

```ts
import { validateTerms, priceOf, withPrice } from "@bloom-exchange/schemas";

const r = validateTerms({ vertical: "compute.gpu", accelerator: "H100-SXM-80GB", acceleratorCount: 8, vramGb: 80, durationSeconds: 86_400, containerDigest: `sha256:${"ab".repeat(32)}`, totalPriceAtomic: "4200000", currency: "USD" });
if (r.ok) console.log(priceOf(r.value)); // "4200000" (USD cents = $42,000)
```
