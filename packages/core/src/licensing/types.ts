/**
 * BLOOM access keys: the signed payload that decides what an operator can open, which engines run, and how the
 * desk looks (the obsidian glass theme morphs to the key's accent and density).
 *
 * Deliberately free of path aliases and Next.js imports: the key scripts in scripts/ import this file directly.
 */

export type KeyRole = "operator" | "agency" | "enterprise" | "eval" | "demo_partner";

/** The only accents a key may carry. Anything else falls back to cyan. */
export const BLOOM_ACCENTS = {
  cyan: "#00F0FF",
  emerald: "#00FF88",
  pink: "#FF007A",
  amber: "#FFB000",
  /** Evaluation keys: a softer emerald that reads as "preview", not "live". */
  softEmerald: "#10B981",
} as const;
export type BloomAccent = (typeof BLOOM_ACCENTS)[keyof typeof BLOOM_ACCENTS];

/** Every theme sits on this base; a key can tint the glass but never lighten the desk. */
export const BLOOM_OBSIDIAN = "#07080C";

export type BloomDensity = "high_density" | "executive" | "minimal";

/** The Demo Engine architectures a demo partner key can open on. */
export const DEMO_ARCHITECTURES = ["music", "trading", "coreops", "intentpulse"] as const;
export type DemoArchitecture = (typeof DEMO_ARCHITECTURES)[number];

export interface BloomThemeConfig {
  /** Hex glowing accent, locked to the BLOOM palette (see BLOOM_ACCENTS). */
  accentColor: string;
  /** Dark obsidian glass, e.g. 'rgba(7, 8, 12, 0.85)'. */
  glassOpacity: string;
  density: BloomDensity;
}

export interface BloomPermissions {
  accessNeuralControlPlane: boolean;
  accessShadowConsensus: boolean;
  accessVectorTree: boolean;
  accessFineTuner: boolean;
  canIssueKeys: boolean;
  isDemoOnly: boolean;
  partnerReferralId?: string;
  /** Demo partner keys only: the architecture Demo Engine Mode opens on (a domain-specific demo key). */
  demoTarget?: DemoArchitecture;
  maxClients: number;
  maxActiveNodes: number;
}

export interface BloomLicensePayload {
  keyId: string;
  holderName: string;
  role: KeyRole;
  /** 4 = Operator, 3 = Agency, 2 = Enterprise, 1 = Eval, 5 = Demo Partner. */
  tier: 1 | 2 | 3 | 4 | 5;
  /** ['*'] for all 8 engines, or specific engine IDs (e.g. ['sovereign', 'apex'] or ['demo_engine']). */
  unlockedEngines: string[];
  themeConfig: BloomThemeConfig;
  permissions: BloomPermissions;
  issuedAt: string;
  /** null = indefinite / lifetime. */
  expiresAt: string | null;
  /** HMAC-SHA256 over the rest of the payload; filled in when a key is decoded. */
  signature: string;
}

/** The payload as it is signed: everything except the signature itself. */
export type UnsignedBloomPayload = Omit<BloomLicensePayload, "signature">;

export const ROLE_TIER: Record<KeyRole, BloomLicensePayload["tier"]> = { operator: 4, agency: 3, enterprise: 2, eval: 1, demo_partner: 5 };

export const ENGINE_IDS = ["sovereign", "apex", "coreops", "intentpulse", "vanguard", "cortex", "shield", "aether"] as const;
export type EngineId = (typeof ENGINE_IDS)[number];
/** The sandbox a demo partner key is locked to. It is not a real engine and runs nothing server-side. */
export const DEMO_ENGINE_ID = "demo_engine";

export const DEFAULT_THEME: BloomThemeConfig = { accentColor: BLOOM_ACCENTS.cyan, glassOpacity: "rgba(7, 8, 12, 0.85)", density: "executive" };

/** Sensible permissions per role; key scripts start from these and override what they need. */
export const ROLE_DEFAULTS: Record<KeyRole, { unlockedEngines: string[]; permissions: BloomPermissions; theme: BloomThemeConfig }> = {
  operator: {
    unlockedEngines: ["*"],
    permissions: { accessNeuralControlPlane: true, accessShadowConsensus: true, accessVectorTree: true, accessFineTuner: true, canIssueKeys: true, isDemoOnly: false, maxClients: 9999, maxActiveNodes: 100000 },
    theme: { accentColor: BLOOM_ACCENTS.cyan, glassOpacity: "rgba(7, 8, 12, 0.85)", density: "high_density" },
  },
  agency: {
    unlockedEngines: ["*"],
    permissions: { accessNeuralControlPlane: false, accessShadowConsensus: true, accessVectorTree: true, accessFineTuner: false, canIssueKeys: false, isDemoOnly: false, maxClients: 25, maxActiveNodes: 2500 },
    theme: { accentColor: BLOOM_ACCENTS.emerald, glassOpacity: "rgba(7, 8, 12, 0.82)", density: "high_density" },
  },
  enterprise: {
    unlockedEngines: ["sovereign", "apex", "coreops"],
    permissions: { accessNeuralControlPlane: false, accessShadowConsensus: true, accessVectorTree: false, accessFineTuner: false, canIssueKeys: false, isDemoOnly: false, maxClients: 1, maxActiveNodes: 1200 },
    theme: { accentColor: BLOOM_ACCENTS.cyan, glassOpacity: "rgba(7, 8, 12, 0.88)", density: "executive" },
  },
  eval: {
    unlockedEngines: ["coreops", "intentpulse"],
    permissions: { accessNeuralControlPlane: false, accessShadowConsensus: false, accessVectorTree: false, accessFineTuner: false, canIssueKeys: false, isDemoOnly: false, maxClients: 1, maxActiveNodes: 50 },
    theme: { accentColor: BLOOM_ACCENTS.amber, glassOpacity: "rgba(7, 8, 12, 0.9)", density: "minimal" },
  },
  demo_partner: {
    unlockedEngines: [DEMO_ENGINE_ID],
    permissions: { accessNeuralControlPlane: false, accessShadowConsensus: false, accessVectorTree: false, accessFineTuner: false, canIssueKeys: false, isDemoOnly: true, maxClients: 0, maxActiveNodes: 0 },
    theme: { accentColor: BLOOM_ACCENTS.pink, glassOpacity: "rgba(7, 8, 12, 0.84)", density: "executive" },
  },
};
