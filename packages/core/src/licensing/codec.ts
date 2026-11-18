import { BLOOM_ACCENTS, DEFAULT_THEME, DEMO_ARCHITECTURES, ENGINE_IDS, DEMO_ENGINE_ID, ROLE_TIER, type BloomLicensePayload, type BloomThemeConfig, type KeyRole, type UnsignedBloomPayload } from "./types.ts";

/**
 * BLOOM access key codec: `BLOOMK-<base64url(JSON payload)>.<base64url(HMAC-SHA256)>`.
 *
 * Runtime-agnostic on purpose. It only uses Web Crypto, TextEncoder and atob/btoa, so the same verifier runs in
 * the Edge middleware (route guard), the Node API routes, and the CLI scripts. The secret is the deployment's
 * LICENSE_SIGNING_SECRET, the same one that signs the older BLOOM- tier keys; without it, development uses a
 * fixed dev secret and production accepts no keys at all.
 */

export const ACCESS_KEY_PREFIX = "BLOOMK-";
/** The httpOnly cookie that carries the verified key to the middleware route guard. */
export const ACCESS_COOKIE = "bloom_access";
export const DEV_SIGNING_SECRET = "bloom-ai-development-license-secret";

const ROLES: KeyRole[] = ["operator", "agency", "enterprise", "eval", "demo_partner"];
const ACCENTS = Object.values(BLOOM_ACCENTS) as string[];
const GLASS = /^rgba\(\s*([0-9]{1,2}|1[0-9]{2}|2[0-4][0-9]|25[0-5])\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*(0(\.\d+)?|1(\.0+)?)\s*\)$/;

export function signingSecret(): { value: string; dev: boolean } | null {
  const s = process.env.LICENSE_SIGNING_SECRET?.trim();
  if (s) return { value: s, dev: false };
  const production = process.env.NODE_ENV === "production" && process.env.BLOOM_DEV_LICENSES !== "true";
  return production ? null : { value: DEV_SIGNING_SECRET, dev: true };
}

const utf8 = new TextEncoder();

export function b64urlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? utf8.encode(input) : input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(input: string): string {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

async function hmac(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", utf8.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64urlEncode(new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8.encode(body))));
}

/** Constant-time string comparison (both inputs are fixed-length base64url signatures). */
function sameSig(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Signs a payload into a key string. The CLI scripts sign with node:crypto instead; both produce the same bytes. */
export async function signAccessKey(payload: UnsignedBloomPayload, secret: string): Promise<string> {
  const body = b64urlEncode(JSON.stringify(payload));
  return `${ACCESS_KEY_PREFIX}${body}.${await hmac(body, secret)}`;
}

/** Locks a theme to the BLOOM palette and an obsidian glass; anything off-palette falls back to the defaults. */
export function sanitizeTheme(t: Partial<BloomThemeConfig> | undefined): BloomThemeConfig {
  const accent = typeof t?.accentColor === "string" ? t.accentColor.toUpperCase() : "";
  const glass = typeof t?.glassOpacity === "string" ? t.glassOpacity.trim() : "";
  const m = glass.match(GLASS);
  // The glass must stay dark: every channel at or below 40 keeps it on the obsidian side.
  const dark = m && [m[1], m[2], m[3]].every((c) => Number(c) <= 40);
  return {
    accentColor: ACCENTS.includes(accent) ? accent : DEFAULT_THEME.accentColor,
    glassOpacity: dark ? glass : DEFAULT_THEME.glassOpacity,
    density: t?.density === "high_density" || t?.density === "minimal" || t?.density === "executive" ? t.density : DEFAULT_THEME.density,
  };
}

/** Engines a key may run. `['*']` is all eight; the demo sandbox id unlocks none. */
export function engineScope(unlocked: string[]): string[] {
  if (unlocked.includes("*")) return [...ENGINE_IDS];
  return unlocked.filter((e): e is (typeof ENGINE_IDS)[number] => (ENGINE_IDS as readonly string[]).includes(e));
}

export type AccessVerifyResult = { ok: true; payload: BloomLicensePayload; dev: boolean } | { ok: false; reason: "format" | "signature" | "expired" | "unavailable" };

const bool = (v: unknown) => v === true;

/** Verifies a BLOOMK- key's signature, shape and expiry, and returns the payload with its signature attached. */
export async function verifyAccessKey(key: string | null | undefined): Promise<AccessVerifyResult> {
  const m = key?.trim().match(/^BLOOMK-([A-Za-z0-9_-]{20,6000})\.([A-Za-z0-9_-]{43})$/);
  if (!m) return { ok: false, reason: "format" };
  const s = signingSecret();
  if (!s) return { ok: false, reason: "unavailable" };
  const [, body, sig] = m;
  if (!sameSig(await hmac(body, s.value), sig)) return { ok: false, reason: "signature" };

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(b64urlDecode(body)) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "format" };
  }
  const role = raw.role as KeyRole;
  const perms = (raw.permissions ?? {}) as Record<string, unknown>;
  if (
    !ROLES.includes(role) ||
    raw.tier !== ROLE_TIER[role] ||
    typeof raw.keyId !== "string" ||
    typeof raw.holderName !== "string" ||
    typeof raw.issuedAt !== "string" ||
    !(raw.expiresAt === null || typeof raw.expiresAt === "string") ||
    !Array.isArray(raw.unlockedEngines) ||
    !raw.unlockedEngines.every((e) => typeof e === "string")
  )
    return { ok: false, reason: "format" };
  if (typeof raw.expiresAt === "string" && !(Date.parse(raw.expiresAt) > Date.now())) return { ok: false, reason: "expired" };

  const isDemoOnly = bool(perms.isDemoOnly) || role === "demo_partner";
  const payload: BloomLicensePayload = {
    keyId: raw.keyId,
    holderName: raw.holderName.slice(0, 120),
    role,
    tier: ROLE_TIER[role],
    // A demo partner key is locked to the sandbox whatever else it lists.
    unlockedEngines: isDemoOnly ? [DEMO_ENGINE_ID] : (raw.unlockedEngines as string[]),
    themeConfig: sanitizeTheme(raw.themeConfig as Partial<BloomThemeConfig>),
    permissions: {
      // Demo keys never reach the control plane, whatever the payload says.
      accessNeuralControlPlane: bool(perms.accessNeuralControlPlane) && !isDemoOnly,
      accessShadowConsensus: bool(perms.accessShadowConsensus) && !isDemoOnly,
      accessVectorTree: bool(perms.accessVectorTree) && !isDemoOnly,
      accessFineTuner: bool(perms.accessFineTuner) && !isDemoOnly,
      canIssueKeys: bool(perms.canIssueKeys) && !isDemoOnly,
      isDemoOnly,
      ...(typeof perms.partnerReferralId === "string" && { partnerReferralId: perms.partnerReferralId.slice(0, 64) }),
      ...(isDemoOnly && (DEMO_ARCHITECTURES as readonly string[]).includes(perms.demoTarget as string) && { demoTarget: perms.demoTarget as BloomLicensePayload["permissions"]["demoTarget"] }),
      maxClients: Number.isFinite(perms.maxClients) ? Math.max(0, Number(perms.maxClients)) : 0,
      maxActiveNodes: Number.isFinite(perms.maxActiveNodes) ? Math.max(0, Number(perms.maxActiveNodes)) : 0,
    },
    issuedAt: raw.issuedAt,
    expiresAt: raw.expiresAt,
    signature: sig,
  };
  return { ok: true, payload, dev: s.dev };
}

/** Reads one cookie from a Cookie header. */
export function cookieValue(header: string | null | undefined, name: string): string | null {
  for (const part of header?.split(";") ?? []) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
