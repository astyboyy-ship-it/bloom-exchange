import type { FirewallVerdict, ResourceDimension } from "./types.ts";

/**
 * The Omni-Protocol ingestion layer. Any surface an agent lives on (a chat message, a CRM webhook, an MCP tool call, a
 * Kubernetes request, an ISO 20022 payment, an arbitrary REST body) is normalized into one `AgentIntentNode`: who is
 * asking, what they're optimizing for in plain English, and the resource vector they need cleared.
 *
 * Normalization is by payload shape: each preset declares where its agent, goal and amount live, and a generic
 * fallback walks any JSON for the same signals (known field names, then quantities written in the goal text:
 * "64 H100s", "2.5 MWh", "$48k", "10 Gbps"). Client-safe: no server imports, so the terminal renders the registry.
 */

export const MACRO_DOMAINS = ["COMMS_SOCIAL", "ENTERPRISE_SAAS", "AGENT_PROTOCOLS", "COMPUTE_INFRA", "FINANCIAL_RAILS", "CUSTOM_OMNI_HOOK"] as const;
export type MacroDomain = (typeof MACRO_DOMAINS)[number];

export type ResourceVector = Record<ResourceDimension, number>;
export const EMPTY_VECTOR: ResourceVector = { computeUnits: 0, energyKwh: 0, capitalUsd: 0, complianceToken: 0, bandwidthGbps: 0 };

/** Where an intent is in the pipeline, and what the deterministic invariants concluded about it. */
export type IntentStage = "received" | "normalized" | "shielded" | "vaulted" | "cleared";
export type InvariantStatus = "locked" | "clamped" | "settled" | "quarantined";

export type AgentIntentNode = {
  id: string;
  domain: MacroDomain;
  protocol: string;
  protocolLabel: string;
  agentName: string;
  /** Plain-English optimization objective, after Shield. */
  coreGoal: string;
  resourceVector: ResourceVector;
  progress: number;
  invariantStatus: InvariantStatus;
  stage: IntentStage;
  shield: { verdict: FirewallVerdict; threats: number; vectors: string[] };
  /** Per dimension: what was requested and what Sovereign granted (present once vaulted). */
  clamp: { dimension: ResourceDimension; requested: number; granted: number }[];
  taskId: string | null;
  certificateId: string | null;
  priceUsd: number | null;
  environment: "sandbox" | "stress-test";
  latencyMs: number | null;
  receivedAt: string;
  trace: { stage: IntentStage | "settled" | "held" | "quarantined"; at: string; detail: string }[];
};

export type ProtocolPreset = {
  id: string;
  domain: MacroDomain;
  label: string;
  /** Wire format, shown on the badge. */
  transport: string;
  /** Dot paths (with [n] indices) tried in order. */
  paths: { agent: string[]; goal: string[]; amount?: string[] };
  /** Multiplier from the amount field's unit to USD (Stripe cents, x402 atomic USDC). */
  amountScale?: number;
  sample: () => unknown;
};

const P = (p: ProtocolPreset) => p;

export const PROTOCOL_REGISTRY: ProtocolPreset[] = [
  // ---- COMMS_SOCIAL --------------------------------------------------------------------------------------
  P({ id: "whatsapp", domain: "COMMS_SOCIAL", label: "WhatsApp", transport: "Cloud API webhook", paths: { agent: ["entry[0].changes[0].value.contacts[0].profile.name"], goal: ["entry[0].changes[0].value.messages[0].text.body"] }, sample: () => ({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { contacts: [{ profile: { name: "Lagos Logistics Agent" } }], messages: [{ type: "text", text: { body: "Reserve 24 A100 GPUs and 6 Gbps for route optimisation this week, budget $38k" } }] } }] }] }) }),
  P({ id: "telegram", domain: "COMMS_SOCIAL", label: "Telegram", transport: "Bot API update", paths: { agent: ["message.from.username"], goal: ["message.text"] }, sample: () => ({ update_id: 81234, message: { from: { username: "quant_research_bot" }, chat: { type: "private" }, text: "Book 64 H100 GPUs for 72h of fine-tuning, max $54k, plus 12 MWh of clean power" } }) }),
  P({ id: "discord", domain: "COMMS_SOCIAL", label: "Discord", transport: "Gateway MESSAGE_CREATE", paths: { agent: ["d.author.username"], goal: ["d.content"] }, sample: () => ({ t: "MESSAGE_CREATE", d: { author: { username: "render-farm-guild" }, content: "Need 18,000 compute units overnight for a render batch, under $45k" } }) }),
  P({ id: "slack", domain: "COMMS_SOCIAL", label: "Slack", transport: "Events API", paths: { agent: ["event.user_profile.real_name", "event.user"], goal: ["event.text"] }, sample: () => ({ type: "event_callback", event: { type: "app_mention", user: "U04PROCURE", user_profile: { real_name: "Procurement Copilot" }, text: "<@bloom> clear 40,000 kWh and 8 Gbps for the Frankfurt cluster, budget $52,000" } }) }),
  P({ id: "x", domain: "COMMS_SOCIAL", label: "X", transport: "Account Activity API", paths: { agent: ["tweet_create_events[0].user.screen_name"], goal: ["tweet_create_events[0].text"] }, sample: () => ({ tweet_create_events: [{ user: { screen_name: "sovereign_ai_fund" }, text: "@BloomExchange source 30 GPUs for inference with 4 compliance attestations, $49k cap" }] }) }),
  P({ id: "email", domain: "COMMS_SOCIAL", label: "Email", transport: "Inbound parse (MIME → JSON)", paths: { agent: ["from.name", "from"], goal: ["text", "subject"] }, sample: () => ({ from: { name: "Ops Agent · Acme Corp", address: "ops-agent@acme.example" }, subject: "Capacity request", text: "Please secure 12 GPUs and 2 Gbps for our Q1 analytics workload. Budget is $46,500." }) }),
  P({ id: "instagram", domain: "COMMS_SOCIAL", label: "Instagram", transport: "Graph API messaging", paths: { agent: ["entry[0].messaging[0].sender.username"], goal: ["entry[0].messaging[0].message.text"] }, sample: () => ({ object: "instagram", entry: [{ messaging: [{ sender: { username: "creator_studio_agent" }, message: { text: "Render 9,000 compute units of video for the campaign, keep it under $44k" } }] }] }) }),
  P({ id: "linkedin", domain: "COMMS_SOCIAL", label: "LinkedIn", transport: "Messaging webhook", paths: { agent: ["sender.name"], goal: ["message.body"] }, sample: () => ({ sender: { name: "Talent Ops Agent" }, message: { body: "Need 6 compliance attestations and 5,000 compute units for screening, $47k budget" } }) }),
  P({ id: "voice_sms", domain: "COMMS_SOCIAL", label: "Voice / SMS", transport: "Twilio webhook", paths: { agent: ["From"], goal: ["Body", "SpeechResult"] }, sample: () => ({ From: "+14155550100", Body: "Field agent: dispatch 20 MWh of backup power to site 7, max $50k" }) }),

  // ---- ENTERPRISE_SAAS -----------------------------------------------------------------------------------
  P({ id: "salesforce", domain: "ENTERPRISE_SAAS", label: "Salesforce", transport: "Platform Event", paths: { agent: ["Owner.Name"], goal: ["Description", "Name"], amount: ["Amount"] }, sample: () => ({ sobject: "Opportunity", Name: "Q1 inference capacity", Owner: { Name: "Revenue Agent (EMEA)" }, Amount: 58000, Description: "Provision 32 GPUs and 6 Gbps for the customer's Q1 inference rollout" }) }),
  P({ id: "hubspot", domain: "ENTERPRISE_SAAS", label: "HubSpot", transport: "CRM webhook", paths: { agent: ["properties.hubspot_owner_name"], goal: ["properties.dealname"], amount: ["properties.amount"] }, sample: () => ({ objectType: "deal", properties: { hubspot_owner_name: "Growth Agent", dealname: "Reserve 15,000 compute units for lead scoring", amount: "48000" } }) }),
  P({ id: "shopify", domain: "ENTERPRISE_SAAS", label: "Shopify", transport: "orders/create webhook", paths: { agent: ["customer.company", "customer.first_name"], goal: ["note", "line_items[0].title"], amount: ["total_price"] }, sample: () => ({ id: 820982911946154500, customer: { company: "Shopify B2B Buyer Agent" }, note: "Wholesale: 4 Gbps edge bandwidth and 2,000 compute units for the storefront AI", total_price: "46990.00", line_items: [{ title: "Edge AI bundle", quantity: 1 }] }) }),
  P({ id: "stripe", domain: "ENTERPRISE_SAAS", label: "Stripe", transport: "Event (checkout.session)", amountScale: 0.01, paths: { agent: ["data.object.metadata.agent"], goal: ["data.object.metadata.goal"], amount: ["data.object.amount_total"] }, sample: () => ({ type: "checkout.session.completed", data: { object: { amount_total: 5200000, currency: "usd", metadata: { agent: "billing-agent", goal: "Settle 10 GPUs of reserved capacity for the annual plan" } } } }) }),
  P({ id: "sap", domain: "ENTERPRISE_SAAS", label: "SAP S/4HANA", transport: "OData PurchaseOrder", paths: { agent: ["PurchasingGroupName"], goal: ["PurchaseOrderItemText"], amount: ["NetAmount"] }, sample: () => ({ PurchaseOrder: "4500017822", PurchasingGroupName: "Plant 1000 Energy Desk", PurchaseOrderItemText: "Procure 30 MWh grid power and 2 compliance attestations", NetAmount: "51000.00", DocumentCurrency: "USD" }) }),
  P({ id: "linear", domain: "ENTERPRISE_SAAS", label: "Linear", transport: "Issue webhook", paths: { agent: ["data.assignee.name"], goal: ["data.title", "data.description"] }, sample: () => ({ action: "create", type: "Issue", data: { assignee: { name: "Infra Agent" }, title: "Spin up 16 GPUs and 4 Gbps for eval suite, cap $47k" } }) }),
  P({ id: "notion", domain: "ENTERPRISE_SAAS", label: "Notion", transport: "Automation webhook", paths: { agent: ["properties.Owner.name"], goal: ["properties.Goal.text"], amount: ["properties.Budget.number"] }, sample: () => ({ object: "page", properties: { Owner: { name: "Research Ops Agent" }, Goal: { text: "Reserve 8,000 compute units for literature synthesis" }, Budget: { number: 45000 } } }) }),
  P({ id: "erp", domain: "ENTERPRISE_SAAS", label: "ERP (NetSuite)", transport: "SuiteTalk REST", paths: { agent: ["employee.refName"], goal: ["memo"], amount: ["total"] }, sample: () => ({ recordType: "purchaseOrder", employee: { refName: "Supply Chain Agent" }, memo: "Monthly: 25 MWh energy and 3 Gbps backbone for the plant", total: 49500 }) }),

  // ---- AGENT_PROTOCOLS -----------------------------------------------------------------------------------
  P({ id: "a2a", domain: "AGENT_PROTOCOLS", label: "A2A v1.0", transport: "JSON-RPC SendMessage", paths: { agent: ["params.message.metadata.agent", "params.metadata.agent"], goal: ["params.message.parts[0].text"] }, sample: () => ({ jsonrpc: "2.0", id: 1, method: "SendMessage", params: { message: { role: "user", metadata: { agent: "partner-procurement-agent" }, parts: [{ kind: "text", text: "Clear 48 GPUs and 10 Gbps for a multi-region launch, $56k ceiling" }] } } }) }),
  P({ id: "mcp", domain: "AGENT_PROTOCOLS", label: "MCP", transport: "tools/call (JSON-RPC)", paths: { agent: ["params._meta.client", "params.arguments.agent"], goal: ["params.arguments.goal"], amount: ["params.arguments.budget_usd"] }, sample: () => ({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "reserve_capacity", _meta: { client: "Claude Desktop · MCP server" }, arguments: { goal: "Reserve 20 GPUs and 5,000 kWh for nightly evals", budget_usd: 48000 } } }) }),
  P({ id: "langgraph", domain: "AGENT_PROTOCOLS", label: "LangGraph", transport: "Graph state", paths: { agent: ["config.configurable.agent_name"], goal: ["state.messages[-1].content", "state.objective"] }, sample: () => ({ config: { configurable: { agent_name: "langgraph-supervisor" } }, state: { objective: "Acquire 12,000 compute units and 3 Gbps for the retrieval pipeline under $47k", messages: [] } }) }),
  P({ id: "crewai", domain: "AGENT_PROTOCOLS", label: "CrewAI", transport: "Task callback", paths: { agent: ["agent.role"], goal: ["task.description"], amount: ["task.budget"] }, sample: () => ({ agent: { role: "Capacity Planner" }, task: { description: "Book 14 GPUs and 2 compliance attestations for the audit crew", budget: 46000 } }) }),
  P({ id: "autogen", domain: "AGENT_PROTOCOLS", label: "AutoGen", transport: "Group-chat message", paths: { agent: ["messages[0].name"], goal: ["messages[0].content"] }, sample: () => ({ messages: [{ name: "planner", role: "assistant", content: "Team needs 10 GPUs and 15 MWh for the simulation sweep, budget $50k" }] }) }),

  // ---- COMPUTE_INFRA -------------------------------------------------------------------------------------
  P({ id: "aws_spot", domain: "COMPUTE_INFRA", label: "AWS Spot", transport: "EC2 Fleet request", paths: { agent: ["TagSpecifications[0].Tags[0].Value"], goal: ["Description"], amount: ["SpotOptions.MaxTotalPrice"] }, sample: () => ({ Description: "p5 fleet for distributed training", TagSpecifications: [{ Tags: [{ Key: "agent", Value: "aws-autoscaler-agent" }] }], TargetCapacitySpecification: { TotalTargetCapacity: 4 }, gpus: 32, SpotOptions: { MaxTotalPrice: "52000" } }) }),
  P({ id: "gcp", domain: "COMPUTE_INFRA", label: "GCP", transport: "Compute reservation", paths: { agent: ["labels.agent"], goal: ["description"] }, sample: () => ({ name: "tpu-reservation", labels: { agent: "gcp-capacity-agent" }, description: "Reserve 18,000 compute units of TPU time and 4 Gbps egress, $49k", specificReservation: { count: 8 } }) }),
  P({ id: "azure", domain: "COMPUTE_INFRA", label: "Azure", transport: "ARM deployment", paths: { agent: ["tags.agent"], goal: ["properties.description"] }, sample: () => ({ type: "Microsoft.Compute/capacityReservations", tags: { agent: "azure-finops-agent" }, properties: { description: "ND H100 v5: 24 GPUs plus 6 Gbps ExpressRoute, budget $53k" } }) }),
  P({ id: "gpu_cluster", domain: "COMPUTE_INFRA", label: "GPU Cluster", transport: "Slurm job", paths: { agent: ["user"], goal: ["comment"] }, sample: () => ({ user: "slurm-scheduler-agent", partition: "h100", gpus: 40, comment: "Pretraining shard 7, 72h window, cap $55k" }) }),
  P({ id: "kubernetes", domain: "COMPUTE_INFRA", label: "Kubernetes", transport: "Admission request", paths: { agent: ["request.userInfo.username"], goal: ["request.object.metadata.annotations.bloom/goal"] }, sample: () => ({ kind: "AdmissionReview", request: { userInfo: { username: "system:serviceaccount:ml:keda-agent" }, object: { metadata: { annotations: { "bloom/goal": "Scale inference to 1,200 vCPUs and 8 GPUs, budget $46k" } }, spec: { containers: [{ resources: { requests: { cpu: "1200", "nvidia.com/gpu": "8" } } }] } } } }) }),
  P({ id: "microgrid", domain: "COMPUTE_INFRA", label: "Energy Microgrid", transport: "OpenADR event", paths: { agent: ["venID"], goal: ["eventDescriptor.description"] }, sample: () => ({ venID: "Tesla Megapack Grid · Site 12", eventDescriptor: { description: "Dispatch 35 MWh of stored solar to the data-center tie-in, $51k" } }) }),
  P({ id: "iot", domain: "COMPUTE_INFRA", label: "IoT Fleet", transport: "MQTT telemetry", paths: { agent: ["deviceId"], goal: ["intent"] }, sample: () => ({ topic: "fleet/edge/requests", deviceId: "edge-fleet-agent-eu", intent: "Edge fleet needs 3 Gbps backhaul and 4,000 kWh for the week, $45k" }) }),

  // ---- FINANCIAL_RAILS -----------------------------------------------------------------------------------
  P({ id: "x402", domain: "FINANCIAL_RAILS", label: "x402 USDC", transport: "PaymentRequirements", amountScale: 0.000001, paths: { agent: ["payTo"], goal: ["description"], amount: ["maxAmountRequired"] }, sample: () => ({ x402Version: 1, scheme: "exact", network: "base", payTo: "0x7a3c…agent-treasury", description: "Prepay 20 GPUs of inference capacity", maxAmountRequired: "48000000000" }) }),
  P({ id: "ethereum", domain: "FINANCIAL_RAILS", label: "Ethereum", transport: "Signed intent (EIP-712)", paths: { agent: ["message.agent"], goal: ["message.goal"], amount: ["message.value_usd"] }, sample: () => ({ primaryType: "ClearingIntent", message: { agent: "dao-treasury-agent.eth", goal: "Fund 10 MWh of renewable credits and 4 compliance attestations", value_usd: 47000 } }) }),
  P({ id: "solana", domain: "FINANCIAL_RAILS", label: "Solana", transport: "Program instruction", paths: { agent: ["accounts.authority"], goal: ["data.memo"], amount: ["data.value_usd"] }, sample: () => ({ programId: "BLooMxch1111", accounts: { authority: "depin-compute-agent" }, data: { memo: "Rent 16 GPUs from the DePIN pool for 48h", value_usd: 46000 } }) }),
  P({ id: "base", domain: "FINANCIAL_RAILS", label: "Base", transport: "Smart-wallet userOp", paths: { agent: ["sender"], goal: ["callData.intent"], amount: ["callData.value_usd"] }, sample: () => ({ sender: "agentkit-wallet.base", callData: { intent: "Settle 6 Gbps bandwidth lease for the onchain indexer", value_usd: 45000 } }) }),
  P({ id: "swift_iso20022", domain: "FINANCIAL_RAILS", label: "SWIFT ISO 20022", transport: "pain.001 (JSON)", paths: { agent: ["GrpHdr.InitgPty.Nm"], goal: ["PmtInf.CdtTrfTxInf.RmtInf.Ustrd"], amount: ["PmtInf.CdtTrfTxInf.Amt.InstdAmt"] }, sample: () => ({ GrpHdr: { MsgId: "BLOOM-20260117-001", InitgPty: { Nm: "Treasury Agent · Northwind Bank" } }, PmtInf: { CdtTrfTxInf: { Amt: { InstdAmt: 54000, Ccy: "USD" }, RmtInf: { Ustrd: "Capital allocation: 28 GPUs and 6 compliance attestations for the risk engine" } } } }) }),
  P({ id: "treasury", domain: "FINANCIAL_RAILS", label: "Treasury API", transport: "Cash-management REST", paths: { agent: ["initiator"], goal: ["purpose"], amount: ["amount.value"] }, sample: () => ({ initiator: "corporate-treasury-agent", purpose: "Hedge Q2 energy: 40 MWh forward block", amount: { value: 52000, currency: "USD" } }) }),

  // ---- CUSTOM_OMNI_HOOK ----------------------------------------------------------------------------------
  P({ id: "rest", domain: "CUSTOM_OMNI_HOOK", label: "REST", transport: "POST application/json", paths: { agent: ["agent"], goal: ["goal"] }, sample: () => ({ agent: "custom-rest-agent", goal: "Clear 10,000 compute units and 2 Gbps for batch ETL, $46k" }) }),
  P({ id: "graphql", domain: "CUSTOM_OMNI_HOOK", label: "GraphQL", transport: "Mutation variables", paths: { agent: ["variables.input.agent"], goal: ["variables.input.objective"], amount: ["variables.input.budgetUsd"] }, sample: () => ({ query: "mutation Clear($input: ClearInput!) { clear(input: $input) { id } }", variables: { input: { agent: "graphql-gateway-agent", objective: "Reserve 12 GPUs for the recommender refresh", budgetUsd: 47000 } } }) }),
  P({ id: "grpc", domain: "CUSTOM_OMNI_HOOK", label: "gRPC", transport: "Protobuf → JSON", paths: { agent: ["header.caller"], goal: ["body.goal"] }, sample: () => ({ header: { caller: "grpc-mesh-agent", method: "/bloom.Clearing/Submit" }, body: { goal: "Allocate 14,000 compute units and 5 Gbps for the mesh, budget $48k" } }) }),
  P({ id: "websocket", domain: "CUSTOM_OMNI_HOOK", label: "WebSocket", transport: "Streaming frame", paths: { agent: ["from"], goal: ["payload.text"] }, sample: () => ({ op: "intent", from: "realtime-trading-agent", payload: { text: "Colocate 8 GPUs with 10 Gbps low-latency link, cap $55k" } }) }),
  P({ id: "custom_schema", domain: "CUSTOM_OMNI_HOOK", label: "Custom schema", transport: "User-defined JSON", paths: { agent: [], goal: [] }, sample: () => ({ who: "custom-agent", want: "Clear 6,000 compute units and 3,000 kWh, $45k" }) }),
];

export const presetById = (id: string) => PROTOCOL_REGISTRY.find((p) => p.id === id);

// -----------------------------------------------------------------------------------------------------------
// Normalization
// -----------------------------------------------------------------------------------------------------------

/** Reads a dot path with [n] (and [-1] for last) indices; keys containing dots or slashes can be quoted segments of the path. */
export function getPath(obj: unknown, path: string): unknown {
  const parts = path.match(/[^.[\]]+|\[-?\d+\]/g) ?? [];
  let cur: unknown = obj;
  for (let i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined) return undefined;
    const part = parts[i];
    const idx = part.match(/^\[(-?\d+)\]$/);
    if (idx) {
      if (!Array.isArray(cur)) return undefined;
      const n = Number(idx[1]);
      cur = cur[n < 0 ? cur.length + n : n];
      continue;
    }
    const rec = cur as Record<string, unknown>;
    // Keys like "bloom/goal" or "nvidia.com/gpu" contain path characters: greedily match the longest existing key.
    let key = part;
    let j = i;
    while (!(key in Object(rec)) && j + 1 < parts.length && !parts[j + 1].startsWith("[")) {
      key = `${key}.${parts[++j]}`;
    }
    if (key in Object(rec)) i = j;
    else key = part;
    cur = rec[key];
  }
  return cur;
}

const clean = (s: string, max: number) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

const firstString = (obj: unknown, paths: string[]) => {
  for (const p of paths) {
    const v = getPath(obj, p);
    if (typeof v === "string" && v.trim()) return v;
    if (v && typeof v === "object" && "address" in v && typeof (v as { address: unknown }).address === "string") return (v as { address: string }).address;
  }
  return null;
};

const toNumber = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[,\s$]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const GOAL_KEYS = /^(text|body|content|message|goal|objective|intent|description|purpose|memo|subject|title|prompt|task|want|comment|note)$/i;
const AGENT_KEYS = /^(agent|agentName|agent_name|user|username|from|sender|author|name|who|caller|initiator|owner|deviceId|client)$/i;
const AMOUNT_KEYS = /^(amount|amount_usd|budget|budgetUsd|budget_usd|total|total_price|totalPrice|price|value_usd|maxTotalPrice|ceiling|cap)$/i;

/** Walks any JSON (bounded) and returns string and numeric leaves with their keys. */
function leaves(obj: unknown, limit = 400): { key: string; path: string; value: unknown }[] {
  const out: { key: string; path: string; value: unknown }[] = [];
  const walk = (v: unknown, key: string, path: string, depth: number) => {
    if (out.length >= limit || depth > 12) return;
    if (Array.isArray(v)) v.slice(0, 50).forEach((x, i) => walk(x, key, `${path}[${i}]`, depth + 1));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 80)) walk(x, k, path ? `${path}.${k}` : k, depth + 1);
    else if (typeof v === "string" || typeof v === "number") out.push({ key, path, value: v });
  };
  walk(obj, "", "", 0);
  return out;
}

const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)`;
const scale = (n: string, unit?: string) => {
  const base = parseFloat(n.replace(/,/g, ""));
  const u = unit?.toLowerCase();
  return base * (u === "k" ? 1e3 : u === "m" || u === "mm" ? 1e6 : 1);
};

/** Quantities written in plain English inside the goal. One GPU counts as 1,000 compute units, one vCPU as 10. */
export function vectorFromText(text: string): Partial<ResourceVector> {
  const v: Partial<ResourceVector> = {};
  const add = (d: ResourceDimension, n: number) => (v[d] = Math.max(v[d] ?? 0, n));
  for (const m of text.matchAll(new RegExp(`${NUM}\\s*(?:x\\s*)?(?:nvidia\\s+)?(?:H100|H200|A100|B200|L40S|MI300X?|TPUs?|GPUs?|accelerators)`, "gi"))) add("computeUnits", scale(m[1]) * 1000);
  for (const m of text.matchAll(new RegExp(`${NUM}\\s*(?:vCPUs?|cores)\\b`, "gi"))) v.computeUnits = (v.computeUnits ?? 0) + scale(m[1]) * 10;
  for (const m of text.matchAll(new RegExp(`${NUM}\\s*(k|m)?\\s*(?:compute units|CU)\\b`, "gi"))) add("computeUnits", scale(m[1], m[2]));
  for (const m of text.matchAll(new RegExp(`${NUM}\\s*(MWh|kWh|GWh)\\b`, "gi"))) add("energyKwh", scale(m[1]) * (m[2].toLowerCase() === "mwh" ? 1e3 : m[2].toLowerCase() === "gwh" ? 1e6 : 1));
  for (const m of text.matchAll(new RegExp(`${NUM}\\s*(Gbps|Tbps)\\b`, "gi"))) add("bandwidthGbps", scale(m[1]) * (m[2].toLowerCase() === "tbps" ? 1e3 : 1));
  for (const m of text.matchAll(new RegExp(`${NUM}\\s*(?:compliance (?:tokens?|attestations?)|attestations?|KYC checks?|audit tokens?)`, "gi"))) add("complianceToken", scale(m[1]));
  for (const m of text.matchAll(new RegExp(`\\$\\s?${NUM}\\s*(k|m|mm)?\\b|${NUM}\\s*(k|m)?\\s*(?:USD|USDC|dollars)\\b`, "gi"))) add("capitalUsd", m[1] ? scale(m[1], m[2]) : scale(m[3], m[4]));
  return v;
}

/** Structured resource fields anywhere in the payload (gpus, cpu requests, kwh, gbps, attestations). */
function vectorFromFields(obj: unknown): Partial<ResourceVector> {
  const v: Partial<ResourceVector> = {};
  const add = (d: ResourceDimension, n: number) => (v[d] = (v[d] ?? 0) + n);
  for (const { key, value } of leaves(obj)) {
    const n = toNumber(value);
    if (n === null || n <= 0) continue;
    if (/^(gpus?|gpu_?count|nvidia\.com\/gpu|accelerators)$/i.test(key)) add("computeUnits", n * 1000);
    else if (/^(cpu|vcpus?|cores)$/i.test(key)) add("computeUnits", n * 10);
    else if (/^(compute_?units|computeUnits)$/i.test(key)) add("computeUnits", n);
    else if (/kwh$/i.test(key)) add("energyKwh", n);
    else if (/mwh$/i.test(key)) add("energyKwh", n * 1000);
    else if (/(gbps|bandwidth)$/i.test(key)) add("bandwidthGbps", n);
    else if (/^(compliance_?tokens?|attestations?)$/i.test(key)) add("complianceToken", n);
  }
  return v;
}

// -----------------------------------------------------------------------------------------------------------
// Global pulse (aggregates only: no names, no goal text)
// -----------------------------------------------------------------------------------------------------------

export type PulseSample = { at: string; domain: MacroDomain; protocol: string; agent: string; vector: ResourceVector; latencyMs: number; status: InvariantStatus };

export type PulseStats = {
  windowMinutes: number;
  adapters: number;
  domains: number;
  enclaves: number;
  settled: number;
  clamped: number;
  quarantined: number;
  protocolsActive: number;
  domainsActive: Record<MacroDomain, number>;
  swarms: number;
  perMinute: number;
  throughput: ResourceVector;
  medianLatencyMs: number | null;
  p95LatencyMs: number | null;
  healthPct: number | null;
};

export function aggregatePulse(samples: PulseSample[], now = Date.now(), windowMinutes = 15): PulseStats {
  const since = now - windowMinutes * 60_000;
  const recent = samples.filter((s) => Date.parse(s.at) >= since);
  const lat = recent.map((s) => s.latencyMs).sort((a, b) => a - b);
  const q = (p: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] : null);
  const throughput: ResourceVector = { ...EMPTY_VECTOR };
  const domainsActive = Object.fromEntries(MACRO_DOMAINS.map((d) => [d, 0])) as Record<MacroDomain, number>;
  for (const s of recent) {
    domainsActive[s.domain]++;
    if (s.status === "settled") for (const d of Object.keys(throughput) as ResourceDimension[]) throughput[d] += s.vector[d] ?? 0;
  }
  const settled = recent.filter((s) => s.status === "settled").length;
  const quarantined = recent.filter((s) => s.status === "quarantined").length;
  const lastFive = recent.filter((s) => Date.parse(s.at) >= now - 5 * 60_000).length;
  return {
    windowMinutes,
    adapters: PROTOCOL_REGISTRY.length,
    domains: MACRO_DOMAINS.length,
    enclaves: recent.length,
    settled,
    clamped: recent.filter((s) => s.status === "clamped").length,
    quarantined,
    protocolsActive: new Set(recent.map((s) => s.protocol)).size,
    domainsActive,
    swarms: new Set(recent.map((s) => s.agent)).size,
    perMinute: Math.round((lastFive / 5) * 10) / 10,
    throughput,
    medianLatencyMs: q(0.5),
    p95LatencyMs: q(0.95),
    // Clearing rate: of the intents Shield let through, the share that settled (the rest were held at a mandate bound).
    healthPct: recent.length - quarantined > 0 ? Math.round((settled / (recent.length - quarantined)) * 1000) / 10 : null,
  };
}

export type NormalizedIntent = Pick<AgentIntentNode, "domain" | "protocol" | "protocolLabel" | "agentName" | "coreGoal" | "resourceVector"> & { scanText: string };

/**
 * Normalizes any payload. `protocol` is a registry id or "custom"; `source` names a custom protocol ("Tesla Megapack
 * Grid"); `goal` overrides the extracted goal when an operator types one. Never throws on odd shapes: an unreadable
 * payload still yields a node, with a goal and agent derived from whatever it has.
 */
export function normalize(input: { protocol: string; payload?: unknown; source?: string; goal?: string }): NormalizedIntent {
  const preset = presetById(input.protocol);
  let payload = input.payload;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = { text: payload };
    }
  }
  const all = leaves(payload);
  const strings = all.filter((l) => typeof l.value === "string") as { key: string; path: string; value: string }[];

  const label = preset ? preset.label : clean(input.source || "Custom protocol", 60) || "Custom protocol";
  const agent = (preset && firstString(payload, preset.paths.agent)) || strings.find((s) => AGENT_KEYS.test(s.key) && s.value.length <= 120)?.value || `${label} agent`;
  const extracted = (preset && firstString(payload, preset.paths.goal)) || strings.filter((s) => GOAL_KEYS.test(s.key)).sort((a, b) => b.value.length - a.value.length)[0]?.value || strings.sort((a, b) => b.value.length - a.value.length)[0]?.value || "";
  const goal = clean(input.goal?.trim() || extracted || `Clear resources requested via ${label}`, 600);

  const text = vectorFromText(goal);
  const fields = vectorFromFields(payload);
  const vector: ResourceVector = { ...EMPTY_VECTOR };
  for (const d of Object.keys(vector) as ResourceDimension[]) vector[d] = Math.round(Math.max(text[d] ?? 0, fields[d] ?? 0) * 100) / 100;
  let amount: number | null = null;
  for (const p of preset?.paths.amount ?? []) {
    const n = toNumber(getPath(payload, p));
    if (n !== null) {
      amount = n * (preset?.amountScale ?? 1);
      break;
    }
  }
  if (amount === null) for (const l of all) if (AMOUNT_KEYS.test(l.key)) amount = Math.max(amount ?? 0, toNumber(l.value) ?? 0) || amount;
  if (amount !== null && amount > 0) vector.capitalUsd = Math.max(vector.capitalUsd, Math.round(amount * 100) / 100);

  return {
    domain: preset?.domain ?? "CUSTOM_OMNI_HOOK",
    protocol: preset?.id ?? "custom",
    protocolLabel: label,
    agentName: clean(agent, 80) || `${label} agent`,
    coreGoal: goal,
    resourceVector: vector,
    // Everything an attacker controls is screened: goal, agent name and every other string leaf.
    scanText: [...new Set([goal, agent, ...strings.map((s) => s.value)])].join("\n").slice(0, 8000),
  };
}
