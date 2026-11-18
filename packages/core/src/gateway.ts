import { after } from "./platform/after.ts";
import { z } from "zod";
import { ownKeys } from "./platform/own-keys.ts";
import { decideLive, type LiveDecision } from "./guard/live-access.ts";
import { rateLimit } from "./guard/rate-limit.ts";
import { meterRun } from "./guard/spend.ts";
import { resolveLicense, type ResolvedLicense } from "./licensing/server.ts";
import type { OwnKeys } from "./platform/provider.ts";
import { canonicalize } from "./canonical.ts";
import { sha256Hex } from "./crypto.ts";
import { peerFramework } from "./bloom-bridge.ts";
import { cancelEnclave, provisionEnclave, resumeEnclave, runEnclave, type EnclaveRecord, type RunDeps } from "./enclave.ts";
import { apexFor } from "./live-model.ts";
import { roundMessage, toA2ATask, type A2ATask } from "./projection.ts";
import { claimIdempotency, getStandingMandate, loadTask, probeCount, saveTask } from "./store.ts";
import { CounterpartyMandateSchema, DEFAULT_STANDING_MANDATE, InitiatorMandateSchema, ItemSchema, TERMINAL, type Environment, type ExchangeEvent } from "./types.ts";

/**
 * The A2A clearing gateway shared by both protocol bindings (JSON-RPC 2.0 at /api/exchange/a2a, HTTP+JSON under
 * /api/exchange/a2a/v1). Who the caller is decides everything else:
 *   operator   an access key with control-plane rights: may run stress tests and see operator telemetry
 *   licensed   any other verified key: negotiates against the provider's standing mandate (environment production)
 *   anonymous  no key: a sandbox enclave against the default (or its own sandbox) mandate, deterministic simulation
 * Live models run only where the existing live-access guard grants them, under the server's spend caps.
 */

export const A2A_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key, A2A-Version, x-bloom-license, x-bloom-view, x-anthropic-key, x-openrouter-key",
  "Access-Control-Expose-Headers": "Idempotency-Replayed",
  "Cache-Control": "no-store",
};

export type Caller = {
  license: ResolvedLicense;
  licensed: boolean;
  operator: boolean;
  own: OwnKeys;
  decision: LiveDecision;
  owner: string;
  origin: string;
  userAgent: string | null;
  signal: AbortSignal;
  wantsOperatorView: boolean;
};

export function rawLicense(req: Request): string | null {
  const header = req.headers.get("x-bloom-license")?.trim();
  if (header) return header;
  const auth = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  return auth && /^BLOOMK?-/.test(auth) ? auth : null;
}

export const isOperator = (l: ResolvedLicense) => l.access?.permissions.accessNeuralControlPlane === true || l.access?.role === "operator" || l.tier === "admin";

export async function callerFor(req: Request): Promise<Caller> {
  const raw = rawLicense(req);
  const license = await resolveLicense(raw);
  const licensed = !license.readOnly && (license.access !== null || license.tier !== "evaluation");
  const own = ownKeys(req);
  const decision = await decideLive(req, license, own, raw);
  return {
    license,
    licensed,
    operator: licensed && isOperator(license),
    own,
    decision,
    owner: sha256Hex(`owner:${decision.identity}`).slice(0, 24),
    origin: process.env.BLOOM_EXCHANGE_PUBLIC_URL?.trim().replace(/\/$/, "") || new URL(req.url).origin,
    userAgent: req.headers.get("user-agent"),
    signal: req.signal,
    wantsOperatorView: req.headers.get("x-bloom-view") === "operator",
  };
}

export const RATE = { own: 30, licensed: 30, anonymous: 10 } as const;
export const limitCaller = (c: Caller) => rateLimit("exchange", c.decision.identity, RATE[c.decision.tier]);

/** Operator telemetry is for the provider only: its operator key, or whoever created a sandbox enclave. */
export const mayViewOperator = (c: Caller, rec: Pick<EnclaveRecord, "environment">) => c.operator || rec.environment === "sandbox";

// ---------------------------------------------------------------------------------------------------------
// Request shapes (lenient on A2A envelope details, strict on the negotiation payload)
// ---------------------------------------------------------------------------------------------------------

const Part = z.object({ kind: z.string().optional(), text: z.string().max(8000).optional(), data: z.record(z.string(), z.unknown()).optional() }).passthrough();
const Message = z
  .object({
    messageId: z.string().max(200).optional(),
    role: z.string().max(40).optional(),
    parts: z.array(Part).min(1).max(16),
    taskId: z.string().max(80).optional(),
    contextId: z.string().max(80).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export const SendParams = z
  .object({
    message: Message,
    configuration: z.object({ blocking: z.boolean().optional(), historyLength: z.number().int().min(0).max(100).optional() }).passthrough().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export type SendParams = z.infer<typeof SendParams>;

export const Negotiate = z
  .object({
    intent: z.literal("negotiate").default("negotiate"),
    mandate: CounterpartyMandateSchema,
    item: ItemSchema,
    paymentRail: z.enum(["stripe", "x402"]).default("stripe"),
    peer: z.object({ name: z.string().max(120).optional(), framework: z.string().max(40).optional(), agentCard: z.record(z.string(), z.unknown()).optional() }).strict().optional(),
    /** Opts into a private sandbox enclave with this provider mandate, instead of the provider's standing mandate. */
    sandbox: z.object({ initiatorMandate: InitiatorMandateSchema }).strict().optional(),
    /** Honored only for the operator: marks the run as a stress test (non-binding, still on the standing mandate). */
    stressTest: z.boolean().optional(),
    maxTurns: z.number().int().min(2).max(12).optional(),
  })
  .strict();

const Resume = z.object({ mandate: CounterpartyMandateSchema }).passthrough();

export const IdParams = z.object({ id: z.string().min(1).max(80), historyLength: z.number().int().min(0).max(100).optional() }).passthrough();

export class RpcError extends Error {
  constructor(
    public code: number,
    message: string,
    public http: number,
    public data?: unknown,
  ) {
    super(message);
  }
}
export const ERR = {
  invalidParams: (msg: string, data?: unknown) => new RpcError(-32602, msg, 400, data),
  notFound: () => new RpcError(-32001, "Task not found.", 404),
  notCancelable: (msg = "Task cannot be canceled.") => new RpcError(-32002, msg, 409),
  unsupported: (msg: string) => new RpcError(-32004, msg, 400),
  idemConflict: () => new RpcError(-32050, "Idempotency-Key was already used with a different payload.", 422),
  idemPending: () => new RpcError(-32051, "A request with this Idempotency-Key is still being provisioned; retry shortly.", 409),
  notResumable: (msg: string) => new RpcError(-32052, msg, 409),
};

function split(params: SendParams): { text: string; data: Record<string, unknown> | null } {
  const text = params.message.parts.map((p) => p.text ?? "").filter(Boolean).join("\n").slice(0, 4000);
  const dataPart = params.message.parts.find((p) => p.data);
  const raw = dataPart?.data ?? null;
  const data = raw && typeof raw.bloomExchange === "object" && raw.bloomExchange !== null ? (raw.bloomExchange as Record<string, unknown>) : raw;
  return { text, data };
}

// ---------------------------------------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------------------------------------

export type Prepared =
  | { kind: "new"; rec: EnclaveRecord; maxTurns?: number }
  | { kind: "replay"; rec: EnclaveRecord }
  | { kind: "resume"; rec: EnclaveRecord; mandate: z.infer<typeof CounterpartyMandateSchema>; text: string };

/** Validates a send, applies idempotency, and provisions (but does not run) the enclave. */
export async function prepareSend(caller: Caller, params: SendParams, idempotencyKey: string | null): Promise<Prepared> {
  const { text, data } = split(params);

  if (params.message.taskId) {
    const rec = await loadTask(params.message.taskId);
    if (!rec || (rec.environment !== "sandbox" && rec.owner !== caller.owner)) throw ERR.notFound();
    if (rec.state !== "input_required") throw ERR.notResumable(`Task is ${rec.state}; only a task awaiting input can be resumed.`);
    if (rec.exception?.kind === "above_auto_settle") throw ERR.notResumable("Agreed terms await the provider's executive; nothing to revise.");
    const resume = Resume.safeParse(data ?? {});
    if (!resume.success) throw ERR.invalidParams("Resuming needs a data part with a revised `mandate`.", resume.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
    return { kind: "resume", rec, mandate: resume.data.mandate, text };
  }

  const parsed = Negotiate.safeParse(data ?? {});
  if (!parsed.success) throw ERR.invalidParams("Send a data part with { mandate, item } (see the Agent Card's mandate-settlement skill).", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const n = parsed.data;

  const key = idempotencyKey ?? (params.message.messageId ? `msg:${params.message.messageId}` : null);
  const digest = sha256Hex(canonicalize(params));
  const id = `xch_${sha256Hex(`${caller.owner}|${key ?? crypto.randomUUID()}|${Date.now()}`).slice(0, 20)}`;
  if (key) {
    const claim = await claimIdempotency(sha256Hex(`${caller.owner}|${key}`), { taskId: id, digest });
    if (!claim.claimed) {
      if (claim.existing.digest !== digest) throw ERR.idemConflict();
      const prior = await loadTask(claim.existing.taskId);
      if (!prior) throw ERR.idemPending();
      return { kind: "replay", rec: prior };
    }
  }

  // A sandbox mandate is an explicit opt-in to a private sandbox; licensed callers keep their live-model access there.
  const environment: Environment = caller.operator && n.stressTest ? "stress-test" : n.sandbox || !caller.licensed ? "sandbox" : "production";
  const initiator = environment === "sandbox" ? (n.sandbox?.initiatorMandate ?? DEFAULT_STANDING_MANDATE) : (await getStandingMandate()).mandate;
  const live = caller.decision.serverKey || Boolean(caller.own.anthropic || caller.own.openrouter);
  const rec = provisionEnclave({
    id,
    owner: caller.owner,
    environment,
    source: live ? "live" : "simulated",
    origin: caller.origin,
    peerName: n.peer?.name ?? (typeof n.peer?.agentCard?.name === "string" ? n.peer.agentCard.name : "external-agent"),
    framework: peerFramework(n.peer?.framework, caller.userAgent),
    peerCard: n.peer?.agentCard,
    item: n.item,
    preferredRail: n.paymentRail,
    initiator,
    counterparty: n.mandate,
    message: text,
    probes: await probeCount(caller.owner),
  });
  await saveTask(rec);
  return { kind: "new", rec, maxTurns: n.maxTurns };
}

/** Runs a prepared send to its outcome, metering live model spend on the server's key. */
export async function execute(caller: Caller, prepared: Prepared, emit?: RunDeps["emit"]): Promise<EnclaveRecord> {
  if (prepared.kind === "replay") return prepared.rec;
  const { apex, live, provider, model } = apexFor(caller.own, caller.decision.serverKey, caller.signal);
  const meter = meterRun(caller.decision.identity, caller.decision.serverKey && live, () => {});
  meter.emit({ type: "run.start", runId: prepared.rec.id, engine: "apex", mode: live ? "live" : "simulation", provider, model, at: Date.now() });
  const deps: RunDeps = { apex, emit, pacingMs: emit ? 110 : 0, maxTurns: prepared.kind === "new" ? prepared.maxTurns : undefined };
  const rec = prepared.kind === "resume" ? await resumeEnclave(prepared.rec, prepared.mandate, prepared.text, deps) : await runEnclave(prepared.rec, deps);
  meter.emit({ type: "run.end", runId: rec.id, ok: true, output: null, usage: { input: rec.usage.input, output: rec.usage.output }, ms: 0, agents: 1, tools: 0 });
  await meter.flush();
  return rec;
}

export async function sendMessage(caller: Caller, params: SendParams, idempotencyKey: string | null): Promise<{ task: A2ATask; replayed: boolean }> {
  const prepared = await prepareSend(caller, params, idempotencyKey);
  if (params.configuration?.blocking === false && prepared.kind !== "replay") {
    // Returns the submitted task at once; the negotiation continues after the response (poll GetTask or subscribe).
    after(() => execute(caller, prepared).catch(() => undefined));
    return { task: toA2ATask(prepared.rec, params.configuration.historyLength), replayed: false };
  }
  const rec = await execute(caller, prepared);
  return { task: toA2ATask(rec, params.configuration?.historyLength), replayed: prepared.kind === "replay" };
}

export async function getTask(caller: Caller, id: string, historyLength?: number): Promise<A2ATask> {
  const rec = await loadTask(id);
  if (!rec || (rec.environment !== "sandbox" && rec.owner !== caller.owner && !caller.operator)) throw ERR.notFound();
  return toA2ATask(rec, historyLength);
}

export async function cancelTask(caller: Caller, id: string): Promise<A2ATask> {
  const rec = await loadTask(id);
  if (!rec || (rec.environment !== "sandbox" && rec.owner !== caller.owner)) throw ERR.notFound();
  if (TERMINAL.includes(rec.state)) throw ERR.notCancelable(`Task is already ${rec.state}.`);
  return toA2ATask(await cancelEnclave(rec));
}

// ---------------------------------------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------------------------------------

export type StreamResult = Record<string, unknown>;

/** One A2A stream result for one event; operator events are included only for callers entitled to them. */
export function eventResult(rec: EnclaveRecord, e: ExchangeEvent, operator: boolean): StreamResult | null {
  if (e.audience === "operator" && !operator) return null;
  const base = { taskId: rec.id, contextId: rec.contextId };
  if (e.type === "settled" && rec.certificate) {
    return { kind: "artifact-update", ...base, artifact: { artifactId: rec.certificate.certificateId, name: "bloom-settlement-certificate", parts: [{ kind: "data", data: rec.certificate }] }, lastChunk: true, metadata: { "bloom.event": e } };
  }
  const message = e.type === "round" ? roundMessage(rec, e.round) : undefined;
  return { kind: "status-update", ...base, status: { state: e.type === "state" ? e.state : "working", timestamp: e.at, ...(message && { message }) }, final: false, metadata: { "bloom.event": e } };
}

export function finalResult(rec: EnclaveRecord): StreamResult {
  return { kind: "status-update", taskId: rec.id, contextId: rec.contextId, status: toA2ATask(rec).status, final: true, metadata: { "bloom.state": rec.state } };
}

const SSE_HEADERS = { ...A2A_HEADERS, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" };

/** An SSE response whose body is produced by `body(send)`. `send` frames one JSON payload per event. */
export function sseResponse(body: (send: (payload: unknown) => void) => Promise<void>, extraHeaders: Record<string, string> = {}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const write = (s: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          open = false;
        }
      };
      const keepAlive = setInterval(() => write(": keep-alive\n\n"), 15_000);
      try {
        await body((payload) => write(`data: ${JSON.stringify(payload)}\n\n`));
      } catch (err) {
        write(`data: ${JSON.stringify({ error: { code: err instanceof RpcError ? err.code : -32603, message: err instanceof RpcError ? err.message : "Internal error" } })}\n\n`);
      } finally {
        clearInterval(keepAlive);
        open = false;
        try {
          controller.close();
        } catch {
          // Client already gone.
        }
      }
    },
  });
  return new Response(stream, { headers: { ...SSE_HEADERS, ...extraHeaders } });
}

/** Streams a send: the task snapshot, every event as it happens, then the final status. */
export async function streamSend(caller: Caller, prepared: Prepared, send: (r: StreamResult) => void) {
  const operator = caller.wantsOperatorView && mayViewOperator(caller, prepared.rec);
  if (prepared.kind === "replay") return replay(prepared.rec.id, operator, send);
  send(toA2ATask(prepared.rec) as unknown as StreamResult);
  if (prepared.kind === "new") for (const e of prepared.rec.events) {
    const r = eventResult(prepared.rec, e, operator);
    if (r) send(r);
  }
  const rec = await execute(caller, prepared, (e, live) => {
    const r = eventResult(live, e, operator);
    if (r) send(r);
  });
  send(finalResult(rec));
}

/** Replays a stored task's events, then follows it (polling the store) until it settles or 90s pass. */
export async function replay(id: string, operator: boolean, send: (r: StreamResult) => void, signal?: AbortSignal) {
  let rec = await loadTask(id);
  if (!rec) throw ERR.notFound();
  send(toA2ATask(rec) as unknown as StreamResult);
  let seen = 0;
  const until = Date.now() + 90_000;
  while (true) {
    for (const e of rec.events.slice(seen)) {
      const r = eventResult(rec, e, operator);
      if (r) send(r);
    }
    seen = rec.events.length;
    if (TERMINAL.includes(rec.state) || rec.state === "input_required" || Date.now() > until || signal?.aborted) break;
    await new Promise((r) => setTimeout(r, 600));
    rec = (await loadTask(id)) ?? rec;
  }
  send(finalResult(rec));
}
