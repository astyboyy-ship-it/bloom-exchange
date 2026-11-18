/**
 * Model provider selection for Apex (the proposing engine). Sovereign clamps whatever a model proposes, so the
 * provider changes how offers are worded and reasoned, never what can settle.
 *
 * Order: a key the caller sent for this request (own-key mode); then, only when the live-access guard granted
 * the server's key (`serverKey`), ANTHROPIC_API_KEY / OPENROUTER_API_KEY (or an LLM_API_KEY with the matching
 * prefix), unless COMMAND_PROVIDER forces one; otherwise deterministic simulation, which needs no model at all.
 */

/** Keys the caller supplied for this request only. Never stored or logged. */
export type OwnKeys = { anthropic?: string; openrouter?: string };

export type Runtime =
  | { mode: "live"; provider: "anthropic"; model: string; key: string }
  | { mode: "live"; provider: "openrouter"; model: string; models: string[]; key: string; baseUrl: string }
  | { mode: "simulation"; provider: "simulation"; model: "scripted" };

const openrouterModels = () => (process.env.COMMAND_OPENROUTER_MODELS ?? "anthropic/claude-opus-5.5,anthropic/claude-sonnet-5.5").split(",").map((m) => m.trim()).filter(Boolean);
const openrouterBase = () => (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
const anthropicModel = () => process.env.COMMAND_MODEL?.trim() || "claude-opus-5-5";

export function runtime(own: OwnKeys = {}, serverKey = false): Runtime {
  if (own.anthropic) return { mode: "live", provider: "anthropic", model: anthropicModel(), key: own.anthropic };
  if (own.openrouter) {
    const models = openrouterModels();
    return { mode: "live", provider: "openrouter", model: models[0], models, key: own.openrouter, baseUrl: openrouterBase() };
  }
  if (!serverKey) return { mode: "simulation", provider: "simulation", model: "scripted" };
  const llm = process.env.LLM_API_KEY?.trim();
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim() || (llm?.startsWith("sk-ant-") ? llm : undefined);
  const openrouterKey = process.env.OPENROUTER_API_KEY?.trim() || (llm?.startsWith("sk-or-") ? llm : undefined);
  const forced = process.env.COMMAND_PROVIDER?.trim();

  if (forced !== "simulation" && forced !== "openrouter" && anthropicKey) return { mode: "live", provider: "anthropic", model: anthropicModel(), key: anthropicKey };
  if (forced !== "simulation" && forced !== "anthropic" && openrouterKey) {
    const models = openrouterModels();
    return { mode: "live", provider: "openrouter", model: models[0], models, key: openrouterKey, baseUrl: openrouterBase() };
  }
  return { mode: "simulation", provider: "simulation", model: "scripted" };
}
