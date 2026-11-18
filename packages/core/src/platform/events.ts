/**
 * Run events the guards emit while metering a live run (notices about caps, usage, errors). The shape matches
 * Bloom's wider run protocol so a host can forward them unchanged; the Exchange itself only produces the
 * notice, usage and error variants.
 */
export type RunMode = "live" | "simulation";
export type Usage = { input: number; output: number };
type EngineKey = string;

export type RunEvent =
  | { type: "run.start"; runId: string; engine: EngineKey; mode: RunMode; provider: string; model: string; at: number }
  | { type: "agent.start"; agentId: string; engine: EngineKey; parentId: string | null; depth: number; command: string }
  | { type: "reasoning"; agentId: string; text: string }
  | { type: "text"; agentId: string; text: string }
  | { type: "notice"; agentId: string | null; text: string }
  | { type: "agent.end"; agentId: string; engine: EngineKey; ok: boolean; output: unknown; usage: Usage; ms: number }
  | { type: "run.end"; runId: string; ok: boolean; output: unknown; usage: Usage; ms: number; agents: number; tools: number }
  | { type: "error"; agentId: string | null; message: string };
