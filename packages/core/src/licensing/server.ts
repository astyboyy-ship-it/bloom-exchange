import { ACCESS_KEY_PREFIX, verifyAccessKey } from "./codec";
import type { BloomLicensePayload, KeyRole } from "./types";

/**
 * Resolves a Bloom access key (BLOOMK-…, HMAC-signed, see codec.ts) for the clearinghouse. The Exchange needs
 * three facts from it: is the caller verified (production rather than sandbox), is it an operator (stress tests,
 * the server ledger, the standing mandate, node telemetry), and is it read-only (evaluation and demo keys may
 * look but not clear). Keys issued by Bloom AI's licensing remain valid here with the same signing secret.
 */
export type Tier = "evaluation" | "licensed" | "admin";

export type ResolvedLicense = {
  tier: Tier;
  access: BloomLicensePayload | null;
  label: string;
  /** Evaluation and demo-partner keys preview the desk: neither may start a production clearing. */
  readOnly: boolean;
};

const ROLE_LABEL: Record<KeyRole, string> = { operator: "Operator key", agency: "Agency key", enterprise: "Enterprise key", eval: "Evaluation key", demo_partner: "Demo partner key" };

const EVALUATION: ResolvedLicense = { tier: "evaluation", access: null, label: "Sandbox", readOnly: false };

export async function resolveLicense(key: string | null | undefined): Promise<ResolvedLicense> {
  if (!key?.trim().startsWith(ACCESS_KEY_PREFIX)) return EVALUATION;
  const v = await verifyAccessKey(key);
  if (!v.ok) return EVALUATION;
  const readOnly = v.payload.role === "eval" || v.payload.permissions.isDemoOnly;
  return { tier: v.payload.role === "operator" ? "admin" : "licensed", access: v.payload, label: ROLE_LABEL[v.payload.role], readOnly };
}
