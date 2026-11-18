"use client";

import { useMemo } from "react";
import { AlertTriangle, ArrowUpRight, BadgeCheck, BookOpen, Code2, Cpu, Gauge, Handshake, Repeat2, Server, ShieldAlert, ShieldCheck, Target, Wallet, X, Zap, type LucideIcon } from "lucide-react";
import { MACRO_DOMAINS, PROTOCOL_REGISTRY, type MacroDomain, type PulseStats } from "@bloom-exchange/core/omni-adapter";
import { cn } from "@/lib/utils";
import { useExchangeCopy } from "./copy";
import { useDeskCopy } from "./desk-copy";
import { useOmniCopy } from "./omni-copy";
import type { ConsoleMode } from "./SovereignToggle";
import { HashDecode, Panel, PanelHeader, usd } from "./ui";
import type { Exchange, TrafficKind } from "./use-exchange";

const KIND: Record<TrafficKind, { icon: LucideIcon; tone: string }> = {
  handshake: { icon: Handshake, tone: "text-x-ink/55" },
  blocked: { icon: ShieldAlert, tone: "text-[var(--xch-threat)]" },
  round: { icon: Repeat2, tone: "text-x-ink/45" },
  settled: { icon: BadgeCheck, tone: "text-[var(--xch-verified)]" },
  exception: { icon: AlertTriangle, tone: "text-[var(--xch-clamp)]" },
  rejected: { icon: X, tone: "text-[var(--xch-threat)]" },
};

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour12: false });

function Tile({ icon: Icon, label, value, sub, tone, className }: { icon: LucideIcon; label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string; className?: string }) {
  return (
    <div className={cn("xch-card min-w-0 p-4", className)}>
      <p className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.18em] text-x-ink/45">
        <Icon className="size-3.5 text-x-ink/45" strokeWidth={1.5} /> {label}
      </p>
      <p className={cn("xch-display tnum mt-2 truncate text-[30px] leading-none text-x-ink", tone)}>{value}</p>
      {sub && <p className="tnum mt-1.5 truncate font-mono text-[10.5px] text-x-ink/45">{sub}</p>}
    </div>
  );
}

/**
 * The command center: master telemetry from this clearinghouse (volume and receipts from this desk's ledger,
 * latency and clear rate from the 15-minute pulse, node and signing key from /status), the live activity feed,
 * the latest BLOOM-XCH receipts and the protocol registry. Every number is measured; empty states say so.
 */
export function OverviewDashboard({
  x,
  stats,
  mode,
  onInspect,
  onFire,
  onInject,
  onGuide,
  onSdk,
  onDomain,
}: {
  x: Exchange;
  stats: PulseStats | null;
  mode: ConsoleMode;
  onInspect: (taskId: string) => void;
  onFire: () => void;
  onInject: () => void;
  onGuide: () => void;
  onSdk: () => void;
  onDomain: (d: MacroDomain) => void;
}) {
  const t = useDeskCopy().overview;
  const c = useExchangeCopy();
  const o = useOmniCopy();

  const settled = useMemo(() => x.rows.filter((r) => r.state === "completed" && r.certificateId), [x.rows]);
  const volume = settled.reduce((s, r) => s + (r.priceUsd ?? 0), 0);
  const threats = x.rows.reduce((s, r) => s + r.threats, 0) + (stats?.quarantined ?? 0);
  const perDomain = useMemo(() => Object.fromEntries(MACRO_DOMAINS.map((d) => [d, PROTOCOL_REGISTRY.filter((p) => p.domain === d)])) as Record<MacroDomain, typeof PROTOCOL_REGISTRY>, []);
  const live = stats && stats.enclaves > 0;

  const actions: { icon: LucideIcon; label: string; run: () => void; primary?: boolean }[] = [
    { icon: Target, label: t.actions.fire, run: onFire, primary: true },
    { icon: Zap, label: t.actions.inject, run: onInject },
    { icon: BookOpen, label: t.actions.guide, run: onGuide },
    { icon: Code2, label: t.actions.sdk, run: onSdk },
  ];

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-end justify-between gap-6 px-1 pb-2 pt-2">
        <div className="min-w-0 max-w-3xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-x-ink/45">{t.kicker}</p>
          <h1 className="xch-display mt-3 text-[34px] leading-[1.05] text-x-ink sm:text-[48px]">
            {t.title} <span className="xch-gold-italic">{t.accent}</span>
          </h1>
          <p className="mt-3 max-w-2xl text-[13.5px] leading-relaxed text-x-ink/55">{t.sub}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={a.run}
              className={cn(
                "flex items-center gap-2 px-4 py-2 text-[12.5px]",
                a.primary ? "xch-btn-ink" : "xch-btn text-x-ink/80",
              )}
            >
              <a.icon className="size-3.5" strokeWidth={1.6} /> {a.label}
            </button>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile icon={Wallet} label={t.tiles.volume} value={usd(volume)} sub={`${settled.length} · ${t.tiles.volumeSub}`} />
        <Tile icon={Gauge} label={t.tiles.latency} value={live && stats.medianLatencyMs !== null ? `${stats.medianLatencyMs.toFixed(1)} ms` : "—"} sub={live && stats.p95LatencyMs !== null ? `${t.tiles.latencySub} ${stats.p95LatencyMs.toFixed(1)} ms` : t.tiles.awaiting} tone={live ? "text-[var(--xch-verified)]" : undefined} />
        <Tile icon={Cpu} label={t.tiles.enclaves} value={stats?.enclaves ?? "—"} sub={stats?.healthPct !== null && stats?.healthPct !== undefined ? `${stats.healthPct}% ${t.tiles.clearRate}` : t.tiles.awaiting} />
        <Tile icon={ShieldCheck} label={t.tiles.security} value={threats} sub={`${t.tiles.armed} · ${t.tiles.neutralized}`} tone={threats ? "text-[var(--xch-threat)]" : undefined} />
        <Tile className="col-span-2 lg:col-span-1" icon={Server} label={t.tiles.node} value={<span className="text-[22px]">{mode === "sovereign" ? t.tiles.sovereign : t.tiles.cloud}</span>} sub={x.status ? <span dir="ltr">{x.status.kid} · {x.status.source}</span> : t.tiles.nodeSub} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Panel className="xl:col-span-7">
          <PanelHeader icon={Repeat2} title={t.feed.title} sub={t.feed.sub} />
          <ul className="xch-scroll mt-4 max-h-[340px] space-y-1 overflow-y-auto pe-1">
            {x.traffic.length === 0 && <li className="py-10 text-center text-[12px] leading-relaxed text-x-ink/40">{t.feed.empty}</li>}
            {x.traffic.slice(0, 24).map((e) => {
              const k = KIND[e.kind];
              return (
                <li key={e.id} className="xch-row-in grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-[var(--xch-raise)]">
                  <k.icon className={cn("size-3.5", k.tone)} strokeWidth={1.6} />
                  <button type="button" onClick={() => onInspect(e.taskId)} className="min-w-0 text-start">
                    <span className="block truncate text-[12.5px] text-x-ink/85">
                      <span className="text-x-ink/50">{c.radar.kinds[e.kind]} · </span>
                      {e.peer}
                    </span>
                    <span className="block truncate font-mono text-[10.5px] text-x-ink/45" dir="ltr">
                      {e.detail}
                    </span>
                  </button>
                  <span className="tnum font-mono text-[10.5px] text-x-ink/35">{time(e.at)}</span>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel className="xl:col-span-5">
          <PanelHeader icon={BadgeCheck} title={t.receipts.title} />
          <ul className="mt-4 space-y-2">
            {settled.length === 0 && <li className="py-10 text-center text-[12px] text-x-ink/40">{t.receipts.empty}</li>}
            {settled.slice(0, 5).map((r) => (
              <li key={r.taskId}>
                <button type="button" onClick={() => onInspect(r.taskId)} className="group flex w-full items-center gap-3 rounded-[12px] border border-[var(--xch-line)] bg-[var(--xch-card-solid)] px-3 py-2.5 text-start transition-colors duration-150 hover:border-[var(--xch-line-strong)]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-[var(--xch-verified)]">
                      <HashDecode text={r.certificateId!} ms={480} />
                    </span>
                    <span className="block truncate text-[11px] text-x-ink/45">{r.peer.name}</span>
                  </span>
                  <span className="tnum font-mono text-[12.5px] text-x-ink" dir="ltr">
                    {usd(r.priceUsd)}
                  </span>
                  <ArrowUpRight className="size-3.5 text-x-ink/30 transition-colors group-hover:text-x-ink" />
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel>
        <PanelHeader icon={Cpu} title={o.hero.registry} sub={o.hero.registrySub} />
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {MACRO_DOMAINS.map((d) => (
            <button key={d} type="button" onClick={() => onDomain(d)} className="group min-w-0 rounded-[12px] border border-[var(--xch-line)] bg-[var(--xch-card-solid)] px-3.5 py-3 text-start transition-colors duration-150 hover:border-[var(--xch-line-strong)]">
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] text-x-ink">{o.domains[d]}</span>
                <span className="tnum font-mono text-[11px] text-x-ink/45">{perDomain[d].length}</span>
              </span>
              <span className="mt-1 block truncate font-mono text-[10.5px] text-x-ink/40">{perDomain[d].map((p) => p.label).join(" · ")}</span>
            </button>
          ))}
        </div>
      </Panel>
    </div>
  );
}
