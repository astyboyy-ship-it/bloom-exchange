// Tests run fully offline: per-instance memory store, deterministic simulation, no settlement webhooks.
for (const k of [
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "LLM_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
  "BLOOM_EXCHANGE_SETTLEMENT_WEBHOOK_URL",
  "BLOOM_EXCHANGE_PUBLIC_URL",
]) {
  delete process.env[k];
}
process.env.COMMAND_PROVIDER = "simulation";
