import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BloomExchangeClient, cardKeys, verifyAgentCard, verifyCertificate, type AgentCard, type SettlementCertificate } from "@bloom-exchange/sdk";
import { z } from "zod";

/**
 * Bloom Exchange as MCP tools. The server is a thin, stateless client of a Bloom node (any deployment of
 * apps/node, a Sovereign node, or a hosted clearinghouse): every negotiation still runs through that node's
 * gateway, Shield, double-blind vault and Sovereign clamp, and every receipt is verified locally with Ed25519.
 *
 * Tools
 *   negotiate       open a sealed negotiation as the client agent and return the outcome and receipt
 *   verify_receipt  verify a BLOOM-XCH certificate offline against its issuer's Agent Card
 *   publish_intent  normalize any agent's intent through the Omni-Bridge and clear it through the pipeline
 */
export type BloomMcpOptions = {
  /** Base URL of the Bloom node, e.g. http://localhost:3000. */
  baseUrl: string;
  /** Optional Bloom access key (BLOOMK-…): production enclaves instead of the sandbox. */
  accessKey?: string;
  /** How this MCP client's agent introduces itself to the counterparty. */
  agentName?: string;
  fetch?: typeof fetch;
};

const SLA = z.enum(["bronze", "silver", "gold", "platinum"]);
const usd = z.number().positive().max(1e12);

const text = (value: unknown) => ({ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) });

function parseJson<T>(raw: unknown, what: string): T {
  if (typeof raw !== "string") return raw as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${what} is not valid JSON`);
  }
}

function certificateIn(doc: unknown): SettlementCertificate | null {
  if (!doc || typeof doc !== "object") return null;
  const o = doc as Record<string, unknown>;
  if (typeof o.certificateId === "string" && o.signature && o.rounds) return o as unknown as SettlementCertificate;
  return o.certificate ? certificateIn(o.certificate) : null;
}

export function createBloomMcpServer(opts: BloomMcpOptions): McpServer {
  const f = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const base = opts.baseUrl.replace(/\/+$/, "");
  const server = new McpServer({ name: "bloom-exchange", version: "0.1.0" });

  server.registerTool(
    "negotiate",
    {
      title: "Negotiate in a Bloom sandbox",
      description:
        "Open a double-blind negotiation with the Bloom node's provider agent. Your ceiling and budget are sealed in the vault: the provider's engines never see them. Rounds are hash-chained; a settlement returns an Ed25519-signed BLOOM-XCH certificate, verified before this tool returns.",
      inputSchema: {
        item: z.object({ description: z.string().min(2).max(200), quantity: z.number().int().positive().optional() }),
        ceilingPriceUsd: usd.describe("Highest price you will accept. Sealed."),
        maxBudgetUsd: usd.optional().describe("Hard budget, at least the ceiling. Sealed. Defaults to the ceiling."),
        requiredSlaTier: SLA.default("gold"),
        targetNetDays: z.number().int().min(0).max(180).default(30),
        openingPriceUsd: usd.optional().describe("Your first offer. Defaults to 70% of your reserve."),
        message: z.string().max(2000).optional().describe("Free text sent with your opening offer. Screened by Shield."),
        paymentRail: z.enum(["stripe", "x402"]).optional(),
      },
    },
    async (a) => {
      const client = new BloomExchangeClient({ baseUrl: base, accessKey: opts.accessKey, agent: { name: opts.agentName ?? "mcp-client-agent", framework: "custom" }, fetch: f });
      const mandate = { ceilingPriceUsd: a.ceilingPriceUsd, maxBudgetUsd: Math.max(a.maxBudgetUsd ?? a.ceilingPriceUsd, a.ceilingPriceUsd), requiredSlaTier: a.requiredSlaTier, targetNetDays: a.targetNetDays, ...(a.openingPriceUsd !== undefined && { openingPriceUsd: a.openingPriceUsd }) };
      const { task, state, certificate } = await client.negotiate({ mandate, item: a.item, message: a.message, paymentRail: a.paymentRail }).result;
      const verification = certificate ? await client.verifyCertificate(certificate) : null;
      const summary = {
        taskId: task.id,
        state,
        settled: state === "completed" && Boolean(certificate),
        certificateId: certificate?.certificateId ?? null,
        priceUsd: certificate?.terms.priceUsd ?? null,
        netDays: certificate?.terms.netDays ?? null,
        slaTier: certificate?.terms.slaTier ?? null,
        rounds: certificate?.rounds.count ?? null,
        verification,
        note: state === "input_required" ? "Held at the mandate bound: no terms fit inside both sealed limits. Raise your ceiling or relax terms and negotiate again." : undefined,
      };
      return { content: [text(summary), ...(certificate ? [text(certificate)] : [])], structuredContent: summary };
    },
  );

  server.registerTool(
    "verify_receipt",
    {
      title: "Verify a BLOOM-XCH receipt",
      description:
        "Verify a BLOOM-XCH settlement certificate offline: canonical digest, certificate id, round hash chain, Ed25519 signature and both AP2 credential proofs. Keys come from the issuer's Agent Card (fetched from the certificate's issuer URL unless you pass the card).",
      inputSchema: {
        receipt: z.union([z.string(), z.record(z.string(), z.unknown())]).describe("The certificate, or any JSON containing it under `certificate`."),
        agentCard: z.union([z.string(), z.record(z.string(), z.unknown())]).optional().describe("The issuer's Agent Card (object, JSON or URL). Omit to fetch it from the certificate."),
      },
    },
    async (a) => {
      const cert = certificateIn(parseJson(a.receipt, "receipt"));
      if (!cert) return { content: [text("No BLOOM-XCH certificate found in the receipt.")], isError: true };
      let card: AgentCard;
      const src = a.agentCard ?? cert.issuer?.agentCard;
      if (!src) return { content: [text("The certificate names no issuer Agent Card; pass agentCard.")], isError: true };
      if (typeof src === "string" && /^https?:\/\//.test(src)) {
        const r = await f(src, { headers: { Accept: "application/json" } });
        if (!r.ok) return { content: [text(`Agent Card unavailable (${r.status}) at ${src}`)], isError: true };
        card = (await r.json()) as AgentCard;
      } else card = parseJson<AgentCard>(src, "agentCard");
      const cardCheck = await verifyAgentCard(card);
      const result = await verifyCertificate(cert, cardKeys(card));
      const out = { valid: result.valid && cardCheck.valid, certificateId: cert.certificateId, issuer: cert.issuer?.name ?? null, checks: { ...result.checks, agentCard: cardCheck.valid }, reason: !cardCheck.valid ? "the Agent Card supplying the keys does not verify" : result.reason };
      return { content: [text(out)], structuredContent: out };
    },
  );

  server.registerTool(
    "publish_intent",
    {
      title: "Publish an agent intent",
      description:
        "Publish what an agent needs (a goal and, optionally, its native payload from any of 40 protocols: chat, CRM, MCP, cloud, energy, payment rails). The Omni-Bridge normalizes it into an AgentIntentNode, Shield screens it, the vault seals it and Sovereign clamps its resource vector before it clears.",
      inputSchema: {
        goal: z.string().min(3).max(600).describe("Plain-language objective, e.g. 'Reserve 12,000 compute units under $47k'."),
        protocol: z.string().max(40).default("custom").describe("A registered protocol id (e.g. a2a, mcp, slack, aws-spot) or 'custom'."),
        source: z.string().max(60).optional().describe("Name of the publishing agent or system."),
        payload: z.unknown().optional().describe("The protocol's native payload, if any."),
      },
    },
    async (a) => {
      const res = await f(`${base}/api/exchange/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(opts.accessKey && { "x-bloom-license": opts.accessKey }) },
        body: JSON.stringify({ protocol: a.protocol, goal: a.goal, source: a.source ?? opts.agentName, payload: a.payload }),
      });
      const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok || !j) return { content: [text(`Intent rejected (${res.status}): ${JSON.stringify((j as { error?: unknown } | null)?.error ?? j)}`)], isError: true };
      const shield = j.shield as { verdict?: string; threats?: number } | undefined;
      const out = { id: j.id, status: j.invariantStatus, domain: j.domain, protocol: j.protocolLabel, coreGoal: j.coreGoal, shield: shield ?? null, clamp: j.clamp, certificateId: j.certificateId ?? null, priceUsd: j.priceUsd ?? null, latencyMs: j.latencyMs ?? null };
      return { content: [text(out)], structuredContent: out };
    },
  );

  return server;
}
