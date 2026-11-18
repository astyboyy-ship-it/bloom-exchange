"use client";

import { useEffect, useState } from "react";
import { REFRESH_EVENT } from "@/components/desktop/DesktopFrame";
import { MACRO_DOMAINS, type PulseStats } from "@bloom-exchange/core/omni-adapter";
import { cn } from "@/lib/utils";
import { useOmniCopy } from "./omni-copy";

const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : `${Math.round(n)}`);

function Metric({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className="flex shrink-0 items-baseline gap-1.5 border-s border-[var(--xch-line)] ps-3.5">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-x-ink/35">{label}</span>
      <span className={cn("tnum font-mono text-[12px] text-x-ink/90", tone)}>{value}</span>
      {sub && <span className="tnum font-mono text-[10px] text-x-ink/35">{sub}</span>}
    </div>
  );
}

/** Real aggregates from /api/exchange/pulse over the last 15 minutes, refreshed every few seconds, on ⌘R and whenever this desk clears something. */
export function usePulse(tick: number): PulseStats | null {
  const [s, setS] = useState<PulseStats | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/exchange/pulse", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<PulseStats>) : null))
        .then((d) => alive && d && setS(d))
        .catch(() => undefined);
    void load();
    const id = setInterval(load, 4000);
    window.addEventListener(REFRESH_EVENT, load);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener(REFRESH_EVENT, load);
    };
  }, [tick]);
  return s;
}

/**
 * The macro heartbeat across the top of the desk (numbers only). Never invents activity: with nothing cleared yet
 * it says so.
 */
export function GlobalPulse({ stats: s, mode }: { stats: PulseStats | null; mode: "cloud" | "sovereign" }) {
  const t = useOmniCopy();  const active = s && s.enclaves > 0;
  const maxDomain = s ? Math.max(1, ...Object.values(s.domainsActive)) : 1;
  return (
    <div className="border-b border-[var(--xch-line)] bg-[var(--xch-card-solid)]/50">
      <div className="mx-auto flex max-w-[1600px] items-center gap-3.5 xch-noscroll overflow-x-auto px-4 py-2 sm:px-6" aria-live="off">
        <span className="flex shrink-0 items-center gap-2">
          <span className="xch-breathe size-2 rounded-full bg-[var(--xch-verified)]" aria-hidden />
          <span className="xch-breathe-soft font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--xch-verified)]">{t.pulse.live}</span>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-x-ink/40">{mode === "sovereign" ? t.sovereign.view : t.sovereign.cloud}</span>
        </span>
        <Metric label={t.pulse.adapters} value={s?.adapters ?? "—"} sub={`${s?.domains ?? 6} ${t.pulse.domains}`} />
        <div className="flex shrink-0 items-end gap-[3px] border-s border-[var(--xch-line)] ps-3.5" aria-hidden>
          {MACRO_DOMAINS.map((d) => (
            <span key={d} className="block h-3.5 w-1.5 origin-bottom rounded-[1px] bg-[var(--xch-verified)] transition-transform duration-500" style={{ transform: `scaleY(${s ? Math.max(0.12, s.domainsActive[d] / maxDomain) : 0.12})`, opacity: s && s.domainsActive[d] ? 0.85 : 0.25 }} title={d} />
          ))}
        </div>
        {active ? (
          <>
            <Metric label={t.pulse.enclaves} value={s.enclaves} sub={`${s.perMinute}${t.pulse.perMin}`} />
            <Metric label={t.pulse.protocols} value={s.protocolsActive} />
            <Metric label={t.pulse.swarms} value={s.swarms} />
            <Metric label={t.pulse.throughput} value={`${compact(s.throughput.computeUnits)} CU`} sub={`${compact(s.throughput.energyKwh)} kWh · $${compact(s.throughput.capitalUsd)}`} />
            <Metric label={t.pulse.latency} value={`${s.medianLatencyMs?.toFixed(1)} ms`} sub={`${t.pulse.p95} ${s.p95LatencyMs?.toFixed(1)}`} tone="text-[var(--xch-verified)]" />
            <Metric label={t.pulse.clearRate} value={s.healthPct === null ? "—" : `${s.healthPct}%`} sub={s.quarantined ? `${s.quarantined} ⊘` : undefined} />
          </>
        ) : (
          <span className="shrink-0 border-s border-[var(--xch-line)] ps-3.5 font-mono text-[10.5px] text-x-ink/35">{t.pulse.awaiting}</span>
        )}
      </div>
    </div>
  );
}
