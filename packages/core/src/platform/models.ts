/**
 * Models an engine can be calibrated to run on. Claude models run on the Anthropic API directly or through
 * OpenRouter; the others need OpenRouter. Current Claude models manage sampling themselves (temperature and
 * friends return a 400), so the temperature control only applies to the non-Claude models.
 * `pace` scales simulated step latency, so simulation feels like the model chosen.
 */
export type ModelId = "claude-opus-5-5" | "claude-sonnet-5-5" | "claude-haiku-5-5" | "gpt-4o" | "deepseek-v3" | "llama-3.3-70b";

/** `price` is USD per million tokens [input, output], for the testbed's cost estimate (OpenRouter rates are approximate). */
export type ModelInfo = { id: ModelId; label: string; vendor: string; openrouter: string; anthropic: boolean; temperature: boolean; pace: number; note: string; price: [number, number] };

export const MODELS: ModelInfo[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", vendor: "Anthropic", openrouter: "anthropic/claude-opus-5.5", anthropic: true, temperature: false, pace: 1.0, note: "Deepest reasoning. Default.", price: [4, 20] },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", vendor: "Anthropic", openrouter: "anthropic/claude-sonnet-5.5", anthropic: true, temperature: false, pace: 0.65, note: "Fast, strong all-rounder.", price: [2, 10] },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", vendor: "Anthropic", openrouter: "anthropic/claude-haiku-5.5", anthropic: true, temperature: false, pace: 0.35, note: "Lowest latency and cost.", price: [0.1, 0.5] },
  { id: "gpt-4o", label: "GPT-4o", vendor: "OpenAI", openrouter: "openai/gpt-4o", anthropic: false, temperature: true, pace: 0.6, note: "Requires an OpenRouter key.", price: [2.5, 10] },
  { id: "deepseek-v3", label: "DeepSeek V3", vendor: "DeepSeek", openrouter: "deepseek/deepseek-chat", anthropic: false, temperature: true, pace: 0.75, note: "Requires an OpenRouter key.", price: [0.3, 1.1] },
  { id: "llama-3.3-70b", label: "Llama 3.3 70B", vendor: "Meta", openrouter: "meta-llama/llama-3.3-70b-instruct", anthropic: false, temperature: true, pace: 0.45, note: "Requires an OpenRouter key.", price: [0.13, 0.4] },
];

export const MODEL_IDS = MODELS.map((m) => m.id) as [ModelId, ...ModelId[]];
export const DEFAULT_MODEL: ModelId = "claude-opus-5-5";
export const modelInfo = (id: ModelId) => MODELS.find((m) => m.id === id) ?? MODELS[0];

/** Estimated USD for a token count on a model. */
export const costOf = (id: ModelId, usage: { input: number; output: number }) => {
  const [i, o] = modelInfo(id).price;
  return (usage.input * i + usage.output * o) / 1_000_000;
};
