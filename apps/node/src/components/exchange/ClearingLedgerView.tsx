"use client";

import { useMemo, useState } from "react";
import { BarChart3, BookCheck, Check, Download, FileDown, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useExchangeCopy } from "./copy";
import { useDeskCopy } from "./desk-copy";
import { Kpis } from "./kpis";
import { TrafficRadar } from "./radar";
import { StressTest } from "./stress-test";
import { Badge, HashDecode, Panel, PanelHeader, usd, type Tone } from "./ui";
import type { Exchange, Row } from "./use-exchange";

/** Exceptions with no counter terms to settle on (or capacity that doesn't exist) can only be rejected. */
const REJECT_ONLY = new Set(["sla_infeasible", "resource_bounds"]);
/** Exceptions raised because an offer hit the mandate bound read as clamped; the rest wait for an owner's sign-off. */
const CLAMPED = new Set(["out_of_bounds", "resource_bounds"]);

type LedgerStatus = "settled" | "clamped" | "escrow" | "rejected" | "clearing";
const STATUS_TONE: Record<LedgerStatus, Tone> = { settled: "emerald", clamped: "amber", escrow: "solid", rejected: "rose", clearing: "muted" };

function statusOf(r: Row): LedgerStatus {
  if (r.state === "completed") return "settled";
  if (r.state === "input_required") return r.exception && CLAMPED.has(r.exception) ? "clamped" : "escrow";
  if (r.state === "failed" || r.state === "canceled") return "rejected";
  return "clearing";
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour12: false });

function saveJson(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Settled volume per settlement, oldest to newest, with the running total as a hairline. Measured, never padded. */
function ThroughputChart({ rows, className }: { rows: Row[]; className?: string }) {
  const t = useDeskCopy().ledger;
  const points = useMemo(
    () =>
      rows
        .filter((r) => r.state === "completed" && r.priceUsd !== null)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1))
        .slice(-32),
    [rows],
  );
  const W = 640;
  const H = 180;
  const max = Math.max(1, ...points.map((p) => p.priceUsd ?? 0));
  const sum = points.reduce((s, p) => s + (p.priceUsd ?? 0), 0);
  const total = sum || 1;
  const bw = points.length ? Math.min(28, (W - 24) / points.length - 6) : 0;
  const step = points.length ? (W - 24) / points.length : 0;
  let run = 0;
  const line = points
    .map((p, i) => {
      run += p.priceUsd ?? 0;
      return `${i ? "L" : "M"}${(12 + step * i + step / 2).toFixed(1)} ${(H - 18 - (run / total) * (H - 36)).toFixed(1)}`;
    })
    .join(" ");

  return (
    <Panel className={className}>
      <PanelHeader icon={BarChart3} title={t.chart} sub={t.chartSub} right={<span className="tnum font-mono text-[12px] text-x-ink/70">{usd(sum)}</span>} />
      {points.length === 0 ? (
        <p className="grid h-[180px] place-items-center text-[12px] text-x-ink/40">{t.chartEmpty}</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 block h-auto w-full" role="img" aria-label={t.chart}>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={12} x2={W - 12} y1={H - 18 - f * (H - 36)} y2={H - 18 - f * (H - 36)} stroke="rgba(22,17,15,0.06)" />
          ))}
          <line x1={12} x2={W - 12} y1={H - 18} y2={H - 18} stroke="rgba(22,17,15,0.14)" />
          {points.map((p, i) => {
            const h = ((p.priceUsd ?? 0) / max) * (H - 40);
            return (
              <rect key={p.taskId} x={12 + step * i + (step - bw) / 2} y={H - 18 - h} width={bw} height={h} rx={3} fill="#c9a04e" opacity={0.28 + 0.6 * (i / points.length)}>
                <title>{`${p.certificateId ?? p.taskId} · ${usd(p.priceUsd)}`}</title>
              </rect>
            );
          })}
          <path d={line} fill="none" stroke="#7a5c1e" strokeWidth={1.4} />
          <text x={12} y={H - 4} fontSize={9} fill="rgba(22,17,15,0.4)" className="font-mono">
            {time(points[0].updatedAt)}
          </text>
          <text x={W - 12} y={H - 4} fontSize={9} textAnchor="end" fill="rgba(22,17,15,0.4)" className="font-mono">
            {time(points[points.length - 1].updatedAt)}
          </text>
        </svg>
      )}
    </Panel>
  );
}

/** Every enclave on this desk as an institutional ledger: status, counterparty, rounds, amount, one-click receipt export and the owner's decision on held deals. */
function LedgerTable({ x, onInspect, className }: { x: Exchange; onInspect: (taskId: string) => void; className?: string }) {
  const t = useExchangeCopy().ledger;
  const d = useDeskCopy().ledger;
  const out = useExchangeCopy().stress.outcome;
  const [pending, setPending] = useState<string | null>(null);

  const exportOne = async (r: Row) => {
    setPending(r.taskId);
    const v = await x.loadView(r.taskId);
    setPending(null);
    if (!v) return toast.error(d.exportOne);
    saveJson(`${v.certificate?.certificateId ?? v.taskId}.json`, v.certificate ?? v);
  };
  const exportAll = () => saveJson(`bloom-exchange-audit-${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.json`, { exportedAt: new Date().toISOString(), signingKey: x.status?.kid ?? null, rows: x.rows, shieldAudit: x.audit });

  const decide = async (r: Row, action: "override" | "reject") => {
    setPending(r.taskId);
    const v = await x.decide(r.taskId, action);
    setPending(null);
    if (!v) toast.error(action === "override" ? t.override : t.reject);
    else if (v.certificate) {
      toast.success(v.certificate.certificateId);
      onInspect(v.taskId);
    }
  };

  return (
    <Panel className={className}>
      <PanelHeader
        icon={BookCheck}
        title={d.title}
        right={
          <button type="button" onClick={exportAll} disabled={!x.rows.length} className="xch-btn flex items-center gap-1.5 px-3 py-1.5 text-[11.5px] text-x-ink/70 hover:text-x-ink disabled:opacity-40">
            <FileDown className="size-3.5" strokeWidth={1.5} /> {d.exportAll}
          </button>
        }
      />
      <div className="xch-scroll mt-4 max-h-[520px] overflow-auto">
        <table className="tnum w-full min-w-[760px] text-[12px]">
          <thead className="sticky top-0 z-10 bg-[var(--xch-card-solid)]">
            <tr className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-x-ink/40">
              {[d.cols.receipt, d.cols.counterparty, d.cols.status, d.cols.rounds, d.cols.amount, d.cols.time, ""].map((h, i) => (
                <th key={i} className={cn("border-b border-[var(--xch-line)] px-2 py-2 font-normal", i >= 3 && i <= 5 ? "text-end" : "text-start")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {x.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-12 text-center text-[12px] text-x-ink/40">
                  {t.empty}
                </td>
              </tr>
            )}
            {x.rows.map((r) => {
              const s = statusOf(r);
              const held = r.state === "input_required" && r.exception;
              return (
                <tr key={r.taskId} className={cn("xch-row-in group border-b border-[var(--xch-line)] last:border-b-0", s === "settled" && "xch-flash")}>
                  <td className="max-w-[230px] px-2 py-2.5">
                    <button type="button" onClick={() => onInspect(r.taskId)} className="block max-w-full truncate text-start font-mono text-[11.5px] hover:underline" dir="ltr">
                      {r.certificateId ? <HashDecode text={r.certificateId} ms={480} className="text-[var(--xch-verified)]" /> : <span className="text-x-ink/55">{r.taskId}</span>}
                    </button>
                  </td>
                  <td className="max-w-[200px] px-2 py-2.5">
                    <span className="block truncate text-x-ink/85">{r.peer.name}</span>
                    <span className="block truncate font-mono text-[10px] text-x-ink/40">
                      {t.env[r.environment]} · {r.source} · {t.trust} {r.trust}
                    </span>
                  </td>
                  <td className="px-2 py-2.5">
                    <Badge tone={STATUS_TONE[s]}>{s === "clearing" ? out.working : d.status[s]}</Badge>
                    {held && <span className="mt-1 block truncate text-[10.5px] text-[var(--xch-clamp)]">{t.kinds[r.exception!]}</span>}
                  </td>
                  <td className="px-2 py-2.5 text-end font-mono text-x-ink/70">{r.rounds}</td>
                  <td className="px-2 py-2.5 text-end font-mono text-[12.5px] text-x-ink" dir="ltr">
                    {usd(r.priceUsd)}
                  </td>
                  <td className="px-2 py-2.5 text-end font-mono text-[11px] text-x-ink/45">{time(r.updatedAt)}</td>
                  <td className="px-2 py-2.5">
                    <span className="flex justify-end gap-1.5">
                      {held && !REJECT_ONLY.has(r.exception!) && (
                        <button type="button" disabled={pending === r.taskId} onClick={() => void decide(r, "override")} className="flex items-center gap-1 rounded-[7px] border border-[color-mix(in_srgb,var(--xch-verified)_40%,transparent)] px-2.5 py-1 text-[11px] text-[var(--xch-verified)] hover:bg-[color-mix(in_srgb,var(--xch-verified)_7%,transparent)] disabled:opacity-40">
                          <Check className="size-3" /> {t.override}
                        </button>
                      )}
                      {held && (
                        <button type="button" disabled={pending === r.taskId} onClick={() => void decide(r, "reject")} className="flex items-center gap-1 rounded-[7px] border border-[color-mix(in_srgb,var(--xch-threat)_35%,transparent)] px-2.5 py-1 text-[11px] text-[var(--xch-threat)] hover:bg-[color-mix(in_srgb,var(--xch-threat)_6%,transparent)] disabled:opacity-40">
                          <X className="size-3" /> {t.reject}
                        </button>
                      )}
                      <button type="button" disabled={pending === r.taskId} onClick={() => void exportOne(r)} aria-label={d.exportOne} title={d.exportOne} className="xch-btn grid size-7 place-items-center text-x-ink/60 hover:text-x-ink disabled:opacity-40">
                        {pending === r.taskId ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" strokeWidth={1.5} />}
                      </button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function ClearingLedgerView({ x, onInspect }: { x: Exchange; onInspect: (taskId: string) => void }) {
  return (
    <div className="space-y-4">
      <Kpis rows={x.rows} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <ThroughputChart rows={x.rows} className="xl:col-span-7" />
        <TrafficRadar traffic={x.traffic} className="xl:col-span-5" />
        <LedgerTable x={x} onInspect={onInspect} className="xl:col-span-12" />
        <StressTest x={x} onInspect={onInspect} className="xl:col-span-12" />
      </div>
    </div>
  );
}
