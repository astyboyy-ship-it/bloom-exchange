"use client";

import { Boxes, Crosshair, Loader2, Swords, Target, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PublicRound } from "@bloom-exchange/core/types";
import { useExchangeCopy } from "./copy";
import { SCENARIOS, type ScenarioId } from "./scenarios";
import { Badge, ENGINE_TONE, HashDecode, Panel, PanelHeader, usd, type Tone } from "./ui";
import type { Exchange } from "./use-exchange";

const ICONS = { standard: Target, adversarial: Swords, swarm: Boxes, breach: Crosshair };
const OUTCOME_TONE: Record<string, Tone> = { completed: "emerald", input_required: "amber", failed: "rose", canceled: "muted", working: "solid", submitted: "solid" };

function Convergence({ rounds }: { rounds: PublicRound[] }) {
  if (rounds.length < 2) return <div className="h-24" />;
  const prices = rounds.map((r) => r.terms.priceUsd);
  const lo = Math.min(...prices) * 0.97;
  const hi = Math.max(...prices) * 1.02;
  const x = (i: number) => 3 + (i / Math.max(1, rounds.length - 1)) * 94;
  const y = (p: number) => 94 - ((p - lo) / (hi - lo || 1)) * 86;
  const line = (side: PublicRound["by"]) =>
    rounds
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.by === side)
      .map(({ r, i }) => `${x(i).toFixed(2)},${y(r.terms.priceUsd).toFixed(2)}`)
      .join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-24 w-full overflow-visible" aria-hidden>
      {[25, 50, 75].map((g) => (
        <line key={g} x1={0} x2={100} y1={g} y2={g} stroke="rgba(22,17,15,0.05)" vectorEffect="non-scaling-stroke" />
      ))}
      <polyline points={line("initiator")} fill="none" stroke="rgba(22,17,15,0.85)" strokeWidth={1.25} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <polyline points={line("counterparty")} fill="none" stroke="rgba(22,17,15,0.35)" strokeWidth={1.25} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

export function StressTest({ x, onInspect, className }: { x: Exchange; onInspect: (taskId: string) => void; className?: string }) {
  const t = useExchangeCopy().stress;
  const run = x.run;
  const busy = run !== null && (run.state === "submitted" || run.state === "working") && !run.error;

  return (
    <Panel className={className}>
      <PanelHeader icon={Zap} title={t.title} sub={t.sub} />

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {(Object.keys(SCENARIOS) as ScenarioId[]).map((id) => {
          const Icon = ICONS[id];
          const s = SCENARIOS[id];
          const active = run?.scenario === id;
          const ceiling = Math.min(s.mandate.ceilingPriceUsd, s.mandate.maxBudgetUsd);
          return (
            <button
              key={id}
              type="button"
              disabled={busy}
              onClick={() => void x.fire(id)}
              className={cn(
                "group rounded-[10px] border p-3 text-start transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
                active ? "border-[var(--xch-line-strong)] bg-x-ink/[0.035]" : "border-[var(--xch-line)] bg-x-ink/[0.025] hover:border-[var(--xch-line-strong)] hover:bg-x-ink/[0.02]",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-x-ink">
                  <Icon className={cn("size-3.5", id === "adversarial" ? "text-[var(--xch-threat)]" : id === "breach" ? "text-[var(--xch-clamp)]" : "text-x-ink/55")} strokeWidth={1.75} /> {t.scenarios[id].name}
                </span>
                <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-x-ink/40 group-hover:text-x-ink/80">{busy && active ? <Loader2 className="size-3 animate-spin" /> : t.fire}</span>
              </div>
              <p className="mt-1.5 text-[11px] leading-snug text-x-ink/45">{t.scenarios[id].body}</p>
              <p className="tnum mt-2 font-mono text-[10px] text-x-ink/35" dir="ltr">
                ≤ {usd(ceiling)} · {s.mandate.requiredSlaTier}
                {s.mandate.resources ? ` · ${Object.keys(s.mandate.resources).length} dims` : ` · net ${s.mandate.targetNetDays}`}
              </p>
            </button>
          );
        })}
      </div>

      {!run ? (
        <p className="mt-6 py-8 text-center font-mono text-[11px] text-x-ink/35">{t.idle}</p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="min-w-0 rounded-[10px] border border-[var(--xch-line)] bg-x-ink/[0.025] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-x-ink/40">
                {t.rounds} ·{" "}
                <span className="tnum text-x-ink/60" dir="ltr">
                  {run.taskId ?? "…"}
                </span>
              </p>
              <div className="flex items-center gap-2">
                <Badge tone={OUTCOME_TONE[run.state] ?? "muted"}>
                  {busy && <Loader2 className="size-3 animate-spin" />} {busy ? t.running : t.outcome[run.state]}
                </Badge>
                {run.taskId && !busy && (
                  <button type="button" onClick={() => onInspect(run.taskId!)} className="rounded-md border border-[var(--xch-line-strong)] px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-x-ink/75 hover:bg-x-ink/[0.05]">
                    {t.inspect} →
                  </button>
                )}
              </div>
            </div>
            {run.certificateId && (
              <p className="xch-flash mt-2 text-[13px] text-[var(--xch-verified)]">
                <HashDecode text={run.certificateId} />
              </p>
            )}
            <div className="mt-2 flex gap-3 font-mono text-[9.5px] uppercase tracking-[0.12em]">
              <span className="text-x-ink/80">— {t.you}</span>
              <span className="text-x-ink/40">- - {t.them}</span>
            </div>
            <Convergence rounds={run.rounds} />
            <div className="mt-2 max-h-52 xch-scroll overflow-y-auto">
              <table className="tnum w-full font-mono text-[10.5px]">
                <tbody>
                  {run.rounds.map((r) => (
                    <tr key={r.n} className="xch-row-in border-t border-[var(--xch-line)] align-top">
                      <td className="py-1 pe-2 text-x-ink/35">R{r.n}</td>
                      <td className={cn("py-1 pe-2", r.by === "initiator" ? "text-x-ink/85" : "text-x-ink/45")}>{r.by === "initiator" ? t.you : t.them}</td>
                      <td className="py-1 pe-2 text-end text-x-ink" dir="ltr">
                        {usd(r.terms.priceUsd)}
                      </td>
                      <td className="py-1 pe-2 text-x-ink/45" dir="ltr">
                        n{r.terms.netDays}
                      </td>
                      <td className="max-w-0 truncate py-1 text-x-ink/40" title={r.message} dir="ltr">
                        {r.message}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="min-w-0 rounded-[10px] border border-[var(--xch-line)] bg-x-ink/[0.025] p-3">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-x-ink/40">{t.log}</p>
            <ol className="mt-2 max-h-[340px] space-y-1 xch-scroll overflow-y-auto font-mono text-[10.5px] leading-snug">
              {run.error && <li className="text-[var(--xch-threat)]">{run.error}</li>}
              {run.log.map((l) => (
                <li
                  key={l.id}
                  className={cn(
                    "xch-row-in grid grid-cols-[66px_1fr] gap-2 rounded px-1 py-0.5",
                    l.tone === "threat" && "xch-intercept",
                    l.tone === "clamp" && "xch-clamp",
                    l.tone === "good" && "xch-flash",
                  )}
                >
                  <span className={cn("uppercase tracking-[0.1em]", ENGINE_TONE[l.source] ?? "text-x-ink/50")}>{l.source}</span>
                  <span
                    className={cn(
                      l.tone === "good" ? "text-[var(--xch-verified)]" : l.tone === "threat" || l.tone === "bad" ? "text-[var(--xch-threat)]" : l.tone === "clamp" ? "text-[var(--xch-clamp)]" : "text-x-ink/60",
                    )}
                    dir="ltr"
                  >
                    {l.text}
                  </span>
                </li>
              ))}
            </ol>
            {run.scenario === "adversarial" && (
              <details className="mt-3 border-t border-[var(--xch-line)] pt-2">
                <summary className="cursor-pointer font-mono text-[9.5px] uppercase tracking-[0.16em] text-[var(--xch-threat)]/80">{t.payload}</summary>
                <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-x-ink/[0.025] p-2 text-[10px] text-x-ink/45" dir="ltr">
                  {SCENARIOS.adversarial.message.replace(/[\u{E0000}-\u{E007F}]+/gu, "⟨invisible tag payload⟩")}
                </pre>
              </details>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
