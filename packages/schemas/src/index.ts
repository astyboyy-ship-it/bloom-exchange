/**
 * @bloom-exchange/schemas: the commercial terms agents clear on the Bloom relay, as runtime validators and types.
 *
 * Zero dependencies, deterministic, and strict: unknown keys are rejected, so a valid value has exactly one
 * canonical JSON form and can be hashed and signed as-is. Prices are atomic: a decimal integer string counting the
 * currency's smallest unit (USD and EUR: cents; USDC: 10^-6), never a float, so no rounding enters a signed receipt.
 */

export const VERTICALS = ["api.inference", "compute.gpu", "data.retrieval"] as const;
export type Vertical = (typeof VERTICALS)[number];
export const isVertical = (v: unknown): v is Vertical => typeof v === "string" && (VERTICALS as readonly string[]).includes(v);

/** An amount in the currency's smallest unit, as a decimal integer string (up to 30 digits). */
export type Atomic = string;
export const ATOMIC = /^(0|[1-9][0-9]{0,29})$/;
/** ISO 4217 code or a token symbol, upper case: USD, EUR, USDC. */
export const CURRENCY = /^[A-Z][A-Z0-9]{2,9}$/;

export type ApiInferenceTerms = {
  vertical: "api.inference";
  /** Model identifier as the provider names it, e.g. "claude-sonnet-5-5" or "meta/llama-4-70b". */
  model: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  /** Time to first token the provider commits to, in milliseconds. */
  latencySlaMs: number;
  /** Price per 1,000 tokens (input and output alike), atomic. */
  unitPriceAtomic: Atomic;
  currency: string;
};

export type ComputeGpuTerms = {
  vertical: "compute.gpu";
  /** Accelerator model, e.g. "H100-SXM-80GB". */
  accelerator: string;
  acceleratorCount: number;
  /** Memory per accelerator, in GB. */
  vramGb: number;
  durationSeconds: number;
  /** The exact container image that will run: "sha256:<64 hex>". */
  containerDigest: string;
  totalPriceAtomic: Atomic;
  currency: string;
};

export type DataRetrievalTerms = {
  vertical: "data.retrieval";
  datasetId: string;
  /** SHA-256 (hex) of the canonical query, so the query itself never has to be disclosed to clear. */
  queryHashSha256: string;
  /** Oldest acceptable data, in seconds. */
  maxAgeSeconds: number;
  licenseTier: "research" | "commercial" | "enterprise";
  totalPriceAtomic: Atomic;
  currency: string;
};

export type Terms = ApiInferenceTerms | ComputeGpuTerms | DataRetrievalTerms;
export type TermsFor<V extends Vertical> = Extract<Terms, { vertical: V }>;

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] };

// ---------------------------------------------------------------------------------------------------------
// A tiny strict validator (no dependency): each field is checked and copied, so the output has only known keys.
// ---------------------------------------------------------------------------------------------------------

type Field = (v: unknown, path: string, errors: string[]) => unknown;

const int =
  (min: number, max: number): Field =>
  (v, path, errors) => {
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max) errors.push(`${path}: an integer from ${min} to ${max}`);
    return v;
  };
const pattern =
  (re: RegExp, what: string): Field =>
  (v, path, errors) => {
    if (typeof v !== "string" || !re.test(v)) errors.push(`${path}: ${what}`);
    return v;
  };
const oneOf =
  <T extends string>(values: readonly T[]): Field =>
  (v, path, errors) => {
    if (typeof v !== "string" || !(values as readonly string[]).includes(v)) errors.push(`${path}: one of ${values.join(", ")}`);
    return v;
  };

function object<T>(shape: Record<string, Field>, value: unknown, path = "terms"): Validation<T> {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, errors: [`${path}: an object`] };
  const src = value as Record<string, unknown>;
  for (const k of Object.keys(src)) if (!(k in shape)) errors.push(`${path}.${k}: unknown field`);
  const out: Record<string, unknown> = {};
  for (const [k, check] of Object.entries(shape)) {
    if (!(k in src)) {
      errors.push(`${path}.${k}: required`);
      continue;
    }
    out[k] = check(src[k], `${path}.${k}`, errors);
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: out as T };
}

const atomic = pattern(ATOMIC, "an atomic amount (decimal integer string, no sign, no leading zeros)");
const currency = pattern(CURRENCY, "a currency code such as USD or USDC");
const HEX64 = /^[0-9a-f]{64}$/;

const SHAPES: { [V in Vertical]: Record<string, Field> } = {
  "api.inference": {
    vertical: oneOf(["api.inference"]),
    model: pattern(/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/, "a model id (letters, digits, . _ : / @ -; up to 128)"),
    maxInputTokens: int(1, 10_000_000),
    maxOutputTokens: int(1, 1_000_000),
    latencySlaMs: int(1, 600_000),
    unitPriceAtomic: atomic,
    currency,
  },
  "compute.gpu": {
    vertical: oneOf(["compute.gpu"]),
    accelerator: pattern(/^[A-Za-z0-9][A-Za-z0-9._-]{1,47}$/, "an accelerator model (letters, digits, . _ -; up to 48)"),
    acceleratorCount: int(1, 4096),
    vramGb: int(1, 4096),
    durationSeconds: int(60, 31_536_000),
    containerDigest: pattern(/^sha256:[0-9a-f]{64}$/, "sha256:<64 lowercase hex>"),
    totalPriceAtomic: atomic,
    currency,
  },
  "data.retrieval": {
    vertical: oneOf(["data.retrieval"]),
    datasetId: pattern(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/, "a dataset id (letters, digits, . _ : / -; up to 128)"),
    queryHashSha256: pattern(HEX64, "64 lowercase hex"),
    maxAgeSeconds: int(0, 31_536_000),
    licenseTier: oneOf(["research", "commercial", "enterprise"] as const),
    totalPriceAtomic: atomic,
    currency,
  },
};

/** Validates terms for their own `vertical`. The result holds only the schema's fields. */
export function validateTerms(value: unknown): Validation<Terms> {
  const vertical = (value as { vertical?: unknown } | null)?.vertical;
  if (!isVertical(vertical)) return { ok: false, errors: [`terms.vertical: one of ${VERTICALS.join(", ")}`] };
  return object<Terms>(SHAPES[vertical], value);
}

/** Validates terms that must belong to a given vertical. */
export function validateTermsFor<V extends Vertical>(vertical: V, value: unknown): Validation<TermsFor<V>> {
  const r = validateTerms(value);
  if (!r.ok) return r;
  if (r.value.vertical !== vertical) return { ok: false, errors: [`terms.vertical: must be ${vertical}`] };
  return r as Validation<TermsFor<V>>;
}

/** The figure a negotiation moves and a mandate bounds: the unit price for inference, the total otherwise. */
export function priceOf(terms: Terms): Atomic {
  return terms.vertical === "api.inference" ? terms.unitPriceAtomic : terms.totalPriceAtomic;
}

/** The same terms at another price (the field a counter-offer changes). */
export function withPrice<T extends Terms>(terms: T, price: Atomic): T {
  if (!ATOMIC.test(price)) throw new Error("withPrice: not an atomic amount");
  return (terms.vertical === "api.inference" ? { ...terms, unitPriceAtomic: price } : { ...terms, totalPriceAtomic: price }) as T;
}

export const compareAtomic = (a: Atomic, b: Atomic): -1 | 0 | 1 => {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

// ---------------------------------------------------------------------------------------------------------
// Intents: a public listing of what an agent offers or wants. Discovery is public, so an intent carries no
// free text, only typed terms and tags.
// ---------------------------------------------------------------------------------------------------------

export type Role = "buyer" | "seller";
export type IntentInput = {
  vertical: Vertical;
  role: Role;
  /** Up to 16 lowercase tags, e.g. ["h100", "eu-west"]. */
  capabilityTags: string[];
  /** The terms on offer (seller) or wanted (buyer), with the asking or bidding price. */
  spec: Terms;
  /** Lifetime in seconds: 60 s to 30 days. */
  ttlSeconds: number;
};

const TAG = /^[a-z0-9][a-z0-9._-]{0,31}$/;

export function validateIntent(value: unknown): Validation<IntentInput> {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, errors: ["intent: an object"] };
  const v = value as Record<string, unknown>;
  for (const k of Object.keys(v)) if (!["vertical", "role", "capabilityTags", "spec", "ttlSeconds"].includes(k)) errors.push(`intent.${k}: unknown field`);
  if (!isVertical(v.vertical)) errors.push(`intent.vertical: one of ${VERTICALS.join(", ")}`);
  if (v.role !== "buyer" && v.role !== "seller") errors.push("intent.role: buyer or seller");
  const tags = v.capabilityTags;
  if (!Array.isArray(tags) || tags.length > 16 || tags.some((t) => typeof t !== "string" || !TAG.test(t)) || new Set(tags).size !== tags.length) {
    errors.push("intent.capabilityTags: up to 16 distinct lowercase tags (a-z 0-9 . _ -; up to 32 each)");
  }
  if (typeof v.ttlSeconds !== "number" || !Number.isSafeInteger(v.ttlSeconds) || v.ttlSeconds < 60 || v.ttlSeconds > 2_592_000) errors.push("intent.ttlSeconds: an integer from 60 to 2592000");
  const spec = isVertical(v.vertical) ? validateTermsFor(v.vertical, v.spec) : null;
  if (spec && !spec.ok) errors.push(...spec.errors.map((e) => e.replace(/^terms/, "intent.spec")));
  if (errors.length || !spec?.ok) return { ok: false, errors };
  return { ok: true, value: { vertical: v.vertical as Vertical, role: v.role as Role, capabilityTags: [...(tags as string[])].sort(), spec: spec.value, ttlSeconds: v.ttlSeconds as number } };
}
