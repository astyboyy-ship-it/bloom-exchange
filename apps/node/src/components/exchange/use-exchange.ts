"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cardKeys, sseJson, verifyAgentCard, type AgentCard, type Jwk } from "@bloom-exchange/sdk";
import { requestHeaders, useDeskSettings } from "@/lib/settings";
import { DEFAULT_STANDING_MANDATE, InitiatorMandateSchema, type ExchangeEvent, type InitiatorMandate, type OperatorView, type PublicRound, type TaskState } from "@bloom-exchange/core/types";
import type { AgentIntentNode } from "@bloom-exchange/core/omni-adapter";
import { REFRESH_EVENT } from "@/components/desktop/DesktopFrame";
import { SCENARIOS, type ScenarioId } from "./scenarios";

export type Status = { source: "live" | "simulated"; provider: string; environment: "operator" | "production" | "sandbox"; licensed: boolean; operator: boolean; notice: string | null; kid: string; keyOrigin: string };

export type Row = {
  taskId: string;
  updatedAt: string;
  state: TaskState;
  environment: OperatorView["environment"];
  source: OperatorView["source"];
  peer: OperatorView["peer"];
  item: string;
  rounds: number;
  priceUsd: number | null;
  certificateId: string | null;
  exception: NonNullable<OperatorView["exception"]>["kind"] | null;
  trust: number;
  threats: number;
};

export type TrafficKind = "handshake" | "blocked" | "round" | "settled" | "exception" | "rejected";
export type TrafficItem = { id: string; at: string; taskId: string; kind: TrafficKind; peer: string; detail: string };
export type LogLine = { id: number; at: string; source: string; text: string; tone: "info" | "good" | "warn" | "bad" | "threat" | "clamp" };
export type AuditRow = { at: string; taskId: string; peer: string; verdict: string; vectors: Record<string, number>; prevHash: string; hash: string };
export type LiveRun = { scenario: ScenarioId; taskId: string | null; state: TaskState; rounds: PublicRound[]; log: LogLine[]; certificateId: string | null; error: string | null };

const VIEWS_KEY = "bloom-exchange-views";
const MANDATE_KEY = "bloom-exchange-sandbox-mandate";

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the session still works, it just won't be remembered.
  }
}

export function summarize(v: OperatorView): Row {
  return {
    taskId: v.taskId,
    updatedAt: v.updatedAt,
    state: v.state,
    environment: v.environment,
    source: v.source,
    peer: v.peer,
    item: v.item.description,
    rounds: v.rounds.length,
    priceUsd: v.certificate?.terms.priceUsd ?? v.agreedTerms?.priceUsd ?? v.exception?.counterTerms?.priceUsd ?? null,
    certificateId: v.certificate?.certificateId ?? null,
    exception: v.exception?.kind ?? null,
    trust: v.security.trust,
    threats: v.security.threats.length,
  };
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function useExchange() {
  const { settings } = useDeskSettings();
  const headerKey = JSON.stringify(requestHeaders(settings));
  const headers = useMemo(() => JSON.parse(headerKey) as Record<string, string>, [headerKey]);

  const [status, setStatus] = useState<Status | null>(null);
  const [card, setCard] = useState<{ card: AgentCard; verified: boolean; keys: Jwk[] } | null>(null);
  const [mandate, setMandate] = useState<InitiatorMandate>(DEFAULT_STANDING_MANDATE);
  const [views, setViews] = useState<Record<string, OperatorView>>({});
  const [serverRows, setServerRows] = useState<Row[]>([]);
  const [traffic, setTraffic] = useState<TrafficItem[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [intents, setIntents] = useState<AgentIntentNode[]>([]);
  const [pulseTick, setPulseTick] = useState(0);
  // ⌘/Ctrl+R in the desktop frame: re-read status, intents and (for the operator) the ledger.
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    const on = () => setRefreshTick((n) => n + 1);
    window.addEventListener(REFRESH_EVENT, on);
    return () => window.removeEventListener(REFRESH_EVENT, on);
  }, []);
  const [run, setRun] = useState<LiveRun | null>(null);
  const logId = useRef(0);
  const operator = status?.operator === true;

  useEffect(() => {
    let alive = true;
    fetch("/api/exchange/status", { headers, cache: "no-store" })
      .then((r) => r.json() as Promise<Status>)
      .then((s) => alive && setStatus(s))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [headers, refreshTick]);

  useEffect(() => {
    fetch("/.well-known/agent-card.json", { cache: "no-store" })
      .then((r) => r.json() as Promise<AgentCard>)
      .then(async (c) => setCard({ card: c, verified: (await verifyAgentCard(c)).valid, keys: cardKeys(c) }))
      .catch(() => undefined);
  }, []);

  // Sandbox history lives in this browser; the operator's lives on the server.
  useEffect(() => {
    if (!status) return;
    if (status.operator) {
      fetch("/api/exchange/mandate", { headers, cache: "no-store" })
        .then((r) => r.json() as Promise<{ mandate: InitiatorMandate }>)
        .then((d) => d.mandate && setMandate(d.mandate))
        .catch(() => undefined);
      return;
    }
    const local = InitiatorMandateSchema.safeParse(readLocal(MANDATE_KEY, null));
    if (local.success) setMandate(local.data);
    const saved = readLocal<OperatorView[]>(VIEWS_KEY, []);
    setViews(Object.fromEntries(saved.map((v) => [v.taskId, v])));
  }, [status, headers]);

  const pushTraffic = useCallback((items: TrafficItem[]) => {
    if (!items.length) return;
    setTraffic((t) => {
      const ids = new Set(t.map((x) => x.id));
      return [...items.filter((x) => !ids.has(x.id)).reverse(), ...t].slice(0, 80);
    });
  }, []);

  const refreshLedger = useCallback(async () => {
    if (!operator) return;
    try {
      const r = await fetch("/api/exchange/ledger", { headers, cache: "no-store" });
      if (!r.ok) return;
      const d = (await r.json()) as { settled: Row[]; exceptions: Row[]; traffic: Omit<TrafficItem, "id">[]; audit?: AuditRow[] };
      setAudit(d.audit ?? []);
      setServerRows([...d.exceptions, ...d.settled]);
      pushTraffic(d.traffic.map((e) => ({ ...e, id: `srv:${e.at}:${e.taskId}:${e.kind}` })));
    } catch {
      // The next poll retries.
    }
  }, [operator, headers, pushTraffic]);

  useEffect(() => {
    if (!operator) return;
    void refreshLedger();
    const t = setInterval(refreshLedger, 8000);
    return () => clearInterval(t);
  }, [operator, refreshLedger, refreshTick]);

  const storeView = useCallback(
    (v: OperatorView) => {
      setViews((prev) => {
        const next = { ...prev, [v.taskId]: v };
        if (!operator) {
          const list = Object.values(next)
            .filter((x) => x.environment === "sandbox")
            .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
            .slice(0, 20);
          writeLocal(VIEWS_KEY, list);
        }
        return next;
      });
    },
    [operator],
  );

  const rows = useMemo(() => {
    const local = Object.values(views).map(summarize);
    const seen = new Set(local.map((r) => r.taskId));
    return [...local, ...serverRows.filter((r) => !seen.has(r.taskId))].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }, [views, serverRows]);

  const loadView = useCallback(
    async (taskId: string): Promise<OperatorView | null> => {
      if (views[taskId]) return views[taskId];
      const r = await fetch(`/api/exchange/tasks/${taskId}`, { headers, cache: "no-store" });
      if (!r.ok) return null;
      const v = (await r.json()) as OperatorView;
      storeView(v);
      return v;
    },
    [views, headers, storeView],
  );

  const saveMandate = useCallback(
    async (m: InitiatorMandate): Promise<boolean> => {
      if (!InitiatorMandateSchema.safeParse(m).success) return false;
      if (operator) {
        const r = await fetch("/api/exchange/mandate", { method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(m) });
        if (!r.ok) return false;
      } else writeLocal(MANDATE_KEY, m);
      setMandate(m);
      return true;
    },
    [operator, headers],
  );

  /**
   * Fires a real A2A negotiation as an external agent would. `opts` lets the negotiation sandbox name the
   * counterparty and set its sealed ceiling; the request still goes through the same gateway, vault and engines.
   */
  const fire = useCallback(
    async (id: ScenarioId, opts?: { peerName?: string; ceilingPriceUsd?: number }) => {
      const base = SCENARIOS[id];
      const ceiling = opts?.ceilingPriceUsd && opts.ceilingPriceUsd > 0 ? Math.round(opts.ceilingPriceUsd) : null;
      const s = {
        ...base,
        peer: opts?.peerName?.trim() ? { ...base.peer, name: opts.peerName.trim().slice(0, 60) } : base.peer,
        mandate: ceiling
          ? { ...base.mandate, ceilingPriceUsd: ceiling, maxBudgetUsd: Math.max(base.mandate.maxBudgetUsd, Math.round(ceiling * 1.05)), openingPriceUsd: Math.min(base.mandate.openingPriceUsd ?? Infinity, Math.round(ceiling * 0.72)) }
          : base.mandate,
      };
      const line = (source: string, text: string, tone: LogLine["tone"] = "info", at = new Date().toISOString()): LogLine => ({ id: ++logId.current, at, source, text, tone });
      setRun({ scenario: id, taskId: null, state: "submitted", rounds: [], log: [], certificateId: null, error: null });
      const update = (fn: (r: LiveRun) => LiveRun) => setRun((r) => (r ? fn(r) : r));
      const local = (taskId: string, kind: TrafficKind, detail: string, at: string) => pushTraffic([{ id: `loc:${taskId}:${kind}:${at}:${detail.length}`, at, taskId, kind, peer: s.peer.name, detail }]);

      const body = {
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method: "SendStreamingMessage",
        params: {
          message: {
            messageId: crypto.randomUUID(),
            role: "user",
            parts: [
              { kind: "text", text: s.message },
              { kind: "data", data: { bloomExchange: { intent: "negotiate", mandate: s.mandate, item: s.item, paymentRail: id === "breach" || id === "swarm" ? "x402" : "stripe", peer: s.peer, ...(operator ? { stressTest: true } : { sandbox: { initiatorMandate: mandate } }) } } },
            ],
          },
        },
      };
      let taskId: string | null = null;
      try {
        const res = await fetch("/api/exchange/a2a", { method: "POST", headers: { ...headers, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "x-bloom-view": "operator" }, body: JSON.stringify(body) });
        if (!res.body || !res.headers.get("content-type")?.includes("text/event-stream")) {
          const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
        }
        for await (const frame of sseJson(res.body)) {
          const f = frame as { result?: Record<string, unknown>; error?: { message: string } };
          if (f.error) throw new Error(f.error.message);
          const r = f.result;
          if (!r) continue;
          if (r.kind === "task") {
            taskId = String(r.id);
            const tid = taskId;
            update((x) => ({ ...x, taskId: tid }));
            local(tid, "handshake", `${s.peer.framework} agent`, new Date().toISOString());
            continue;
          }
          if (r.final) {
            const st = (r.status as { state: TaskState }).state;
            update((x) => ({ ...x, state: st }));
            continue;
          }
          const e = (r.metadata as Record<string, unknown> | undefined)?.["bloom.event"] as ExchangeEvent | undefined;
          if (!e || !taskId) continue;
          const tid = taskId;
          switch (e.type) {
            case "firewall.scan":
              update((x) => ({ ...x, log: [...x.log, line("shield", e.threats.length ? `Firewall ${e.verdict}: ${e.threats.length} vector${e.threats.length === 1 ? "" : "s"} (${[...new Set(e.threats.map((t) => t.vector))].join(", ")})` : "Firewall clean", e.threats.length ? "threat" : "good", e.at)] }));
              if (e.threats.length) local(tid, "blocked", `${e.threats.length} vectors · ${e.verdict}`, e.at);
              break;
            case "engine.signal":
              update((x) => ({ ...x, log: [...x.log, line(e.engine, e.text, e.engine === "shield" || e.engine === "cortex" ? "warn" : "info", e.at)] }));
              break;
            case "clamp":
              update((x) => ({ ...x, log: [...x.log, line("sovereign", `R${e.round} clamped · ${e.reasons.join(" · ")}`, "clamp", e.at)] }));
              break;
            case "round":
              update((x) => ({ ...x, state: "working", rounds: [...x.rounds, e.round] }));
              local(tid, "round", `R${e.round.n} ${e.round.by === "initiator" ? "provider" : "client"} ${usd(e.round.terms.priceUsd)}`, e.at);
              break;
            case "state":
              update((x) => ({ ...x, state: e.state }));
              break;
            case "exception":
              update((x) => ({ ...x, log: [...x.log, line("sovereign", `Exception raised: ${e.kind.replace(/_/g, " ")}`, "bad", e.at)] }));
              local(tid, "exception", e.kind.replace(/_/g, " "), e.at);
              break;
            case "settled":
              update((x) => ({ ...x, certificateId: e.certificateId, log: [...x.log, line("sovereign", `${e.certificateId} minted at ${usd(e.priceUsd)}`, "good", e.at)] }));
              local(tid, "settled", `${e.certificateId} · ${usd(e.priceUsd)}`, e.at);
              break;
          }
        }
        if (taskId) {
          const r = await fetch(`/api/exchange/tasks/${taskId}`, { headers, cache: "no-store" });
          if (r.ok) storeView((await r.json()) as OperatorView);
          void refreshLedger();
        }
      } catch (err) {
        update((x) => ({ ...x, state: "failed", error: err instanceof Error ? err.message : String(err) }));
      }
    },
    [headers, operator, mandate, pushTraffic, storeView, refreshLedger],
  );

  const decide = useCallback(
    async (taskId: string, action: "override" | "reject"): Promise<OperatorView | null> => {
      const r = await fetch(`/api/exchange/tasks/${taskId}/decision`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      if (!r.ok) return null;
      const v = (await r.json()) as OperatorView;
      storeView(v);
      setServerRows((rows) => rows.filter((x) => x.taskId !== taskId));
      const at = new Date().toISOString();
      pushTraffic([{ id: `loc:${taskId}:decision:${at}`, at, taskId, kind: action === "reject" ? "rejected" : "settled", peer: v.peer.name, detail: v.certificate ? `${v.certificate.certificateId} · override` : "rejected by executive" }]);
      void refreshLedger();
      return v;
    },
    [headers, storeView, pushTraffic, refreshLedger],
  );

  useEffect(() => {
    fetch("/api/exchange/intents", { headers, cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ intents: AgentIntentNode[] }>) : null))
      .then((d) => d && setIntents(d.intents))
      .catch(() => undefined);
  }, [headers, refreshTick]);

  /** Sends any protocol's payload (or a source name and goal) through the live clearing pipeline. */
  const inject = useCallback(
    async (input: { protocol: string; payload?: unknown; source?: string; goal?: string }): Promise<AgentIntentNode | { error: string }> => {
      try {
        const r = await fetch("/api/exchange/ingest", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(input) });
        const j = (await r.json()) as AgentIntentNode & { error?: { message?: string } };
        if (!r.ok) return { error: j.error?.message ?? `HTTP ${r.status}` };
        setIntents((xs) => [j, ...xs.filter((x) => x.id !== j.id)].slice(0, 60));
        setPulseTick((n) => n + 1);
        const at = j.receivedAt;
        const items: TrafficItem[] = [{ id: `int:${j.id}:h`, at, taskId: j.taskId ?? j.id, kind: "handshake", peer: j.agentName, detail: `${j.protocolLabel} · ${j.domain}` }];
        if (j.shield.threats) items.push({ id: `int:${j.id}:b`, at, taskId: j.taskId ?? j.id, kind: "blocked", peer: j.agentName, detail: `${j.shield.threats} vectors · ${j.shield.verdict}` });
        if (j.invariantStatus === "settled" && j.certificateId) items.push({ id: `int:${j.id}:s`, at, taskId: j.taskId ?? j.id, kind: "settled", peer: j.agentName, detail: `${j.certificateId} · ${usd(j.priceUsd ?? 0)}` });
        if (j.invariantStatus === "clamped") items.push({ id: `int:${j.id}:e`, at, taskId: j.taskId ?? j.id, kind: "exception", peer: j.agentName, detail: "held at mandate bound" });
        pushTraffic(items);
        return j;
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
    [headers, pushTraffic],
  );

  return { status, card, mandate, saveMandate, rows, traffic, audit, run, fire, decide, loadView, views, intents, inject, pulseTick, headers };
}

export type Exchange = ReturnType<typeof useExchange>;
