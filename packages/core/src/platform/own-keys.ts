import type { OwnKeys } from "./provider";

/**
 * The operator's own provider keys, sent by the desk as headers on each request (App Settings). They are used
 * for that request only: never stored, logged or echoed back. Shape checks keep junk from reaching providers.
 */
export function ownKeys(req: Request): OwnKeys {
  const anthropic = req.headers.get("x-anthropic-key")?.trim();
  const openrouter = req.headers.get("x-openrouter-key")?.trim();
  return {
    anthropic: anthropic && /^sk-ant-[\w-]{20,}$/.test(anthropic) ? anthropic : undefined,
    openrouter: openrouter && /^sk-or-[\w-]{20,}$/.test(openrouter) ? openrouter : undefined,
  };
}
