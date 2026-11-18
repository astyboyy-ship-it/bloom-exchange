import Anthropic from "@anthropic-ai/sdk";
import { runtime, type OwnKeys } from "./platform/provider";
import { buildApexPrompt, deterministicApex, parseApexReply, type Proposer } from "./bloom-bridge";

/**
 * Apex on a live model. Provider selection is the orchestrator's: the caller's own key first, then the server's
 * key only when the live-access guard granted it (verified license under its spend caps). Anything else gets the
 * deterministic Apex, so an unlicensed visitor never spends the server's key. Each proposal is one short
 * completion; Sovereign clamps whatever comes back.
 */
export function apexFor(own: OwnKeys, serverKey: boolean, signal: AbortSignal): { apex: Proposer; live: boolean; provider: string; model: string } {
  const rt = runtime(own, serverKey);
  if (rt.mode === "simulation") return { apex: deterministicApex, live: false, provider: "simulation", model: "apex/deterministic-v1" };

  if (rt.provider === "anthropic") {
    const client = new Anthropic({ apiKey: rt.key });
    const model = process.env.EXCHANGE_MODEL?.trim() || "claude-sonnet-5-5";
    const apex: Proposer = async (ctx) => {
      const { system, user } = buildApexPrompt(ctx);
      const res = await client.messages.create({ model, max_tokens: 500, system, messages: [{ role: "user", content: user }] }, { signal, timeout: 20_000 });
      const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      const parsed = parseApexReply(text, ctx.plan);
      if (!parsed) throw new Error("unparseable reply");
      return { ...parsed, model, usage: { input: res.usage.input_tokens, output: res.usage.output_tokens } };
    };
    return { apex, live: true, provider: "anthropic", model };
  }

  const models = process.env.EXCHANGE_OPENROUTER_MODELS?.split(",").map((m) => m.trim()).filter(Boolean) ?? ["anthropic/claude-sonnet-5.5", "openai/gpt-4o", "deepseek/deepseek-chat"];
  const apex: Proposer = async (ctx) => {
    const { system, user } = buildApexPrompt(ctx);
    const res = await fetch(`${rt.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${rt.key}`, "Content-Type": "application/json", "HTTP-Referer": process.env.APP_URL ?? "http://localhost:3000", "X-Title": "Bloom Exchange" },
      body: JSON.stringify({ models, messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: 500 }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const j = (await res.json()) as { model?: string; choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const parsed = parseApexReply(j.choices?.[0]?.message?.content ?? "", ctx.plan);
    if (!parsed) throw new Error("unparseable reply");
    return { ...parsed, model: j.model ?? models[0], usage: { input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0 } };
  };
  return { apex, live: true, provider: "openrouter", model: models[0] };
}
