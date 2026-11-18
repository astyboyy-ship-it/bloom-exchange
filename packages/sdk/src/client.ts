import { sseJson } from "./sse.ts";
import { cardKeys, verifyAgentCard, verifyCertificate } from "./verify.ts";
import type { A2ATask, AgentCard, BuyerMandate, ExchangeStreamEvent, Item, Jwk, SettlementCertificate, TaskState, VerificationResult } from "./types.ts";

export type ClientOptions = {
  /** Where Bloom Exchange is served, e.g. "https://bloom.example". */
  baseUrl: string;
  /** A Bloom access key (BLOOMK-…) to negotiate against the provider's live mandate. Omit for the sandbox. */
  accessKey?: string;
  /** How your agent introduces itself. Its card is screened by Bloom's firewall like any other input. */
  agent?: { name?: string; framework?: "openai" | "anthropic" | "langgraph" | "webhook" | "bloom-sdk" | "custom"; card?: Record<string, unknown> };
  fetch?: typeof fetch;
  /** Network retries per request. Every retry reuses the same Idempotency-Key, so a retry can never double-settle. */
  retries?: number;
};

export type NegotiateOptions = {
  mandate: BuyerMandate;
  item: Item;
  /** Free text sent with your opening offer. Bloom's firewall screens it before any engine reads it. */
  message?: string;
  paymentRail?: "stripe" | "x402";
  maxTurns?: number;
  idempotencyKey?: string;
};

export type NegotiationResult = { task: A2ATask; state: TaskState; certificate: SettlementCertificate | null };

export type NegotiationRun = AsyncIterable<ExchangeStreamEvent> & { result: Promise<NegotiationResult> };

// Erasable syntax only (no parameter properties), so Node can run the sources directly with type stripping.
export class BloomExchangeError extends Error {
  readonly code: number;
  readonly data?: unknown;
  constructor(message: string, code: number, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

const uuid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

/**
 * Connects an external agent to Bloom Exchange over A2A v1.0 JSON-RPC:
 *   const bloom = new BloomExchangeClient({ baseUrl });
 *   const { certificate } = await bloom.negotiate({ mandate, item }).result;
 *   const proof = await bloom.verifyCertificate(certificate!);
 */
export class BloomExchangeClient {
  private readonly opts: ClientOptions;
  private readonly base: string;
  private readonly f: typeof fetch;
  private card: AgentCard | null = null;
  private keys: Jwk[] = [];

  constructor(opts: ClientOptions) {
    this.opts = opts;
    this.base = opts.baseUrl.replace(/\/+$/, "");
    this.f = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** Fetches the Agent Card, checks its signature and pins its settlement keys. Called on first use. */
  async connect(): Promise<AgentCard> {
    if (this.card) return this.card;
    const res = await this.f(`${this.base}/.well-known/agent-card.json`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new BloomExchangeError(`Agent card unavailable (${res.status})`, res.status);
    const card = (await res.json()) as AgentCard;
    const check = await verifyAgentCard(card);
    if (!check.valid) throw new BloomExchangeError("Agent card signature does not verify.", -32000);
    this.card = card;
    this.keys = cardKeys(card);
    return card;
  }

  private endpoint(): string {
    return this.card?.supportedInterfaces.find((i) => i.protocolBinding === "JSONRPC")?.url ?? `${this.base}/api/exchange/a2a`;
  }

  private headers(idempotencyKey?: string): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(this.opts.accessKey && { Authorization: `Bearer ${this.opts.accessKey}` }),
      ...(idempotencyKey && { "Idempotency-Key": idempotencyKey }),
      ...(typeof window === "undefined" && { "User-Agent": "bloom-exchange-sdk/1.0" }),
    };
  }

  private async post(body: unknown, idempotencyKey?: string): Promise<Response> {
    const attempts = 1 + Math.max(0, this.opts.retries ?? 2);
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await this.f(this.endpoint(), { method: "POST", headers: this.headers(idempotencyKey), body: JSON.stringify(body) });
        if (res.status >= 500 && i < attempts - 1) continue;
        return res;
      } catch (err) {
        last = err;
        await new Promise((r) => setTimeout(r, 250 * 2 ** i));
      }
    }
    throw last instanceof Error ? last : new BloomExchangeError("Network error", -32603);
  }

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    await this.connect();
    const res = await this.post({ jsonrpc: "2.0", id: uuid(), method, params });
    const j = (await res.json()) as { result?: T; error?: { code: number; message: string; data?: unknown } };
    if (j.error) throw new BloomExchangeError(j.error.message, j.error.code, j.error.data);
    return j.result as T;
  }

  private payload(o: NegotiateOptions, taskId?: string) {
    const agent = this.opts.agent ?? {};
    const data = taskId
      ? { bloomExchange: { mandate: o.mandate } }
      : {
          bloomExchange: {
            intent: "negotiate",
            mandate: o.mandate,
            item: { quantity: 1, ...o.item },
            paymentRail: o.paymentRail ?? "stripe",
            peer: { name: agent.name ?? "external-agent", framework: agent.framework ?? "bloom-sdk", ...(agent.card && { agentCard: agent.card }) },
            ...(o.maxTurns && { maxTurns: o.maxTurns }),
          },
        };
    return {
      message: {
        messageId: uuid(),
        role: "user",
        ...(taskId && { taskId }),
        parts: [...(o.message ? [{ kind: "text", text: o.message }] : []), { kind: "data", data }],
      },
    };
  }

  /** Deposits your mandate and streams the negotiation round by round. Await `.result` for the outcome. */
  negotiate(o: NegotiateOptions): NegotiationRun {
    return this.stream(this.payload(o), o.idempotencyKey ?? uuid());
  }

  /** Sends a revised mandate to a task that is awaiting input (`input_required`) and streams the resumed rounds. */
  resume(taskId: string, mandate: BuyerMandate, message?: string): NegotiationRun {
    return this.stream(this.payload({ mandate, item: { description: "" }, message }, taskId), uuid());
  }

  private stream(params: unknown, idempotencyKey: string): NegotiationRun {
    const queue: ExchangeStreamEvent[] = [];
    const waiter: { wake: (() => void) | null } = { wake: null };
    let finished = false;
    let failure: unknown = null;
    const push = (e: ExchangeStreamEvent) => {
      queue.push(e);
      waiter.wake?.();
    };

    const result = (async (): Promise<NegotiationResult> => {
      try {
        await this.connect();
        const res = await this.post({ jsonrpc: "2.0", id: idempotencyKey, method: "SendStreamingMessage", params }, idempotencyKey);
        if (!res.headers.get("content-type")?.includes("text/event-stream")) {
          const j = (await res.json()) as { error?: { code: number; message: string; data?: unknown } };
          throw new BloomExchangeError(j.error?.message ?? `HTTP ${res.status}`, j.error?.code ?? res.status, j.error?.data);
        }
        let taskId = "";
        let certificate: SettlementCertificate | null = null;
        for await (const frame of sseJson(res.body!)) {
          const f = frame as { result?: Record<string, unknown>; error?: { code: number; message: string } };
          if (f.error) throw new BloomExchangeError(f.error.message, f.error.code);
          const r = f.result;
          if (!r) continue;
          if (r.kind === "task") {
            taskId = String(r.id);
            push({ type: "task", task: r as unknown as A2ATask });
            continue;
          }
          if (r.kind === "artifact-update") {
            const art = r.artifact as { parts: { data?: unknown }[] };
            certificate = (art.parts[0]?.data as SettlementCertificate) ?? null;
            if (certificate) push({ type: "settled", certificate });
            continue;
          }
          const ev = (r.metadata as Record<string, unknown> | undefined)?.["bloom.event"] as Record<string, unknown> | undefined;
          if (r.final) {
            push({ type: "final", state: (r.status as { state: TaskState }).state });
            continue;
          }
          if (!ev) continue;
          if (ev.type === "round") push({ type: "round", round: ev.round as never });
          else if (ev.type === "firewall.scan") push({ type: "firewall", verdict: ev.verdict as never, threats: ev.threats as never });
          else if (ev.type === "state") push({ type: "state", state: ev.state as TaskState, ...(typeof ev.reason === "string" && { reason: ev.reason }) });
          else if (ev.type === "engine.signal") push({ type: "signal", engine: String(ev.engine), text: String(ev.text) });
        }
        const task = await this.getTask(taskId);
        return { task, state: task.status.state, certificate: certificate ?? ((task.artifacts[0]?.parts[0]?.data as SettlementCertificate | undefined) ?? null) };
      } catch (err) {
        failure = err;
        throw err;
      } finally {
        finished = true;
        waiter.wake?.();
      }
    })();
    // The caller may only await `result`; don't surface an unhandled rejection from the iterator side.
    result.catch(() => undefined);

    return {
      result,
      async *[Symbol.asyncIterator]() {
        while (true) {
          if (queue.length) {
            yield queue.shift()!;
            continue;
          }
          if (finished) {
            if (failure) throw failure;
            return;
          }
          await new Promise<void>((r) => (waiter.wake = r));
          waiter.wake = null;
        }
      },
    };
  }

  getTask(id: string, historyLength?: number): Promise<A2ATask> {
    return this.rpc<A2ATask>("GetTask", { id, ...(historyLength !== undefined && { historyLength }) });
  }

  cancel(id: string): Promise<A2ATask> {
    return this.rpc<A2ATask>("CancelTask", { id });
  }

  /** Verifies a certificate offline against the keys pinned from the Agent Card. */
  async verifyCertificate(cert: SettlementCertificate): Promise<VerificationResult> {
    await this.connect();
    return verifyCertificate(cert, this.keys);
  }
}
