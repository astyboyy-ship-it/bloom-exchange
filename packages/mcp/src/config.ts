import type { BloomMcpOptions } from "./server.ts";

/** Reads the node location and optional key from the environment (the usual way MCP clients pass config). */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): BloomMcpOptions {
  return {
    baseUrl: env.BLOOM_EXCHANGE_URL?.trim() || "http://localhost:3000",
    accessKey: env.BLOOM_ACCESS_KEY?.trim() || undefined,
    agentName: env.BLOOM_AGENT_NAME?.trim() || undefined,
  };
}
