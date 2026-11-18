import os from "node:os";
import { exchangeKeys, sha256Hex } from "./crypto";
import type { Caller } from "./gateway";
import { kvConfig } from "./platform/kv";
import { listAudit, type AuditEntry } from "./store";

/**
 * What the terminal's Sovereign console shows about the node it is talking to. The deployment mode is a fact of the
 * server (BLOOM_SOVEREIGN_NODE=1, set by the sovereign-node image), not a UI preference. Public: mode, root key
 * fingerprint, and the egress posture as booleans. Operator only: host hardware, persistence endpoints and the
 * Shield audit ledger with its hash chain re-verified on every request.
 */

export type NodeStatus = {
  mode: "sovereign" | "cloud";
  root: { alg: "Ed25519"; kid: string; fingerprint: string; origin: string };
  posture: { airGapped: boolean; modelEgress: boolean; webhookEgress: boolean; persistence: "local-redis" | "remote-kv" | "memory"; database: boolean };
  operator: boolean;
  hardware: null | { hostname: string; platform: string; arch: string; node: string; cpus: number; cpuModel: string; memTotalGb: number; memFreeGb: number; loadAvg: number[]; uptimeHours: number; processRssMb: number };
  audit: null | { entries: AuditEntry[]; chain: { checked: number; intact: boolean; brokenAt: string | null } };
};

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|[a-z0-9-]+$)/i;

/** Recomputes each entry's hash and its link to the next-older entry (entries are newest first). */
export function verifyAuditChain(entries: AuditEntry[]): { checked: number; intact: boolean; brokenAt: string | null } {
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const expected = sha256Hex(JSON.stringify({ at: e.at, taskId: e.taskId, peer: e.peer, verdict: e.verdict, vectors: e.vectors, prevHash: e.prevHash }));
    const older = entries[i + 1];
    if (expected !== e.hash || (older && e.prevHash !== older.hash)) return { checked: i + 1, intact: false, brokenAt: e.hash.slice(0, 12) };
  }
  return { checked: entries.length, intact: true, brokenAt: null };
}

export async function nodeStatus(caller: Caller): Promise<NodeStatus> {
  const keys = exchangeKeys();
  const kv = kvConfig();
  const persistence = !kv ? "memory" : PRIVATE_HOST.test(new URL(kv.url).hostname) ? "local-redis" : "remote-kv";
  const modelEgress = Boolean(process.env.LLM_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim()) && process.env.COMMAND_PROVIDER?.trim() !== "simulation";
  const webhookEgress = Boolean(process.env.BLOOM_EXCHANGE_SETTLEMENT_WEBHOOK_URL?.trim());
  const status: NodeStatus = {
    mode: process.env.BLOOM_SOVEREIGN_NODE === "1" ? "sovereign" : "cloud",
    root: { alg: "Ed25519", kid: keys.jwk.kid, fingerprint: keys.fingerprint, origin: keys.origin },
    posture: { airGapped: !modelEgress && !webhookEgress && persistence !== "remote-kv", modelEgress, webhookEgress, persistence, database: Boolean(process.env.DATABASE_URL?.trim()) },
    operator: caller.operator,
    hardware: null,
    audit: null,
  };
  if (!caller.operator) return status;

  const cpus = os.cpus();
  status.hardware = {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    node: process.version,
    cpus: cpus.length,
    cpuModel: cpus[0]?.model?.trim() ?? "unknown",
    memTotalGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    memFreeGb: Math.round((os.freemem() / 1024 ** 3) * 10) / 10,
    loadAvg: os.loadavg().map((n) => Math.round(n * 100) / 100),
    uptimeHours: Math.round((os.uptime() / 3600) * 10) / 10,
    processRssMb: Math.round(process.memoryUsage().rss / 1024 ** 2),
  };
  const entries = await listAudit(50);
  status.audit = { entries, chain: verifyAuditChain(entries) };
  return status;
}
