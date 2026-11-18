"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Cloud, Cpu, Fingerprint, Lock, ScrollText, Server, ShieldCheck, ShieldX, Terminal, Wifi, WifiOff } from "lucide-react";
import { REFRESH_EVENT } from "@/components/desktop/DesktopFrame";
import type { NodeStatus } from "@bloom-exchange/core/node-status";
import { cn } from "@/lib/utils";
import { useOmniCopy } from "./omni-copy";
import { Badge, HashDecode, Panel, PanelHeader, SPRING, short } from "./ui";

export type ConsoleMode = "cloud" | "sovereign";

/** The header switch between the cloud sandbox perspective and the Sovereign Private Node console. */
export function SovereignToggle({ mode, onChange }: { mode: ConsoleMode; onChange: (m: ConsoleMode) => void }) {
  const t = useOmniCopy().sovereign;
  return (
    <div role="radiogroup" aria-label={t.node} className="relative inline-flex rounded-lg border border-[var(--xch-line)] bg-x-ink/[0.025] p-0.5">
      {(["cloud", "sovereign"] as const).map((m) => {
        const Icon = m === "cloud" ? Cloud : Server;
        return (
          <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => onChange(m)} className={cn("relative flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] transition-colors duration-150", mode === m ? (m === "sovereign" ? "text-[var(--xch-verified)]" : "text-x-ink") : "text-x-ink/45 hover:text-x-ink/80")}>
            {mode === m && <motion.span layoutId="xch-mode" className="absolute inset-0 rounded-md bg-x-ink/[0.07]" transition={SPRING} />}
            <Icon className="relative size-3.5" strokeWidth={1.75} />
            <span className="relative hidden whitespace-nowrap md:inline">{m === "cloud" ? t.cloud : t.node}</span>
          </button>
        );
      })}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-[var(--xch-line)] py-2 first:border-t-0">
      <span className="text-[11.5px] text-x-ink/45">{label}</span>
      <span className={cn("tnum min-w-0 truncate text-end font-mono text-[11.5px] text-x-ink/85", tone)} dir="ltr">
        {value}
      </span>
    </div>
  );
}

export function SovereignConsole({ headers }: { headers: Record<string, string> }) {
  const t = useOmniCopy().sovereign;
  const [s, setS] = useState<NodeStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/exchange/node", { headers, cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<NodeStatus>) : null))
        .then((d) => alive && d && setS(d))
        .catch(() => undefined);
    void load();
    const id = setInterval(load, 5000);
    window.addEventListener(REFRESH_EVENT, load);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener(REFRESH_EVENT, load);
    };
  }, [headers]);

  if (!s) return <Panel className="min-h-[300px]">{null}</Panel>;
  const sovereign = s.mode === "sovereign";
  const yesNo = (b: boolean, good: boolean) => <span className={b === good ? "text-[var(--xch-verified)]" : "text-[var(--xch-clamp)]"}>{b ? t.yes : t.no}</span>;
  const hw = s.hardware;
  const usedMem = hw ? Math.max(0, hw.memTotalGb - hw.memFreeGb) : 0;

  return (
    <div className="space-y-4">
      <section className={cn("xch-card relative overflow-hidden p-4 sm:p-5", sovereign ? "border-[color-mix(in_srgb,var(--xch-verified)_35%,transparent)]" : "")}>
        <div className="flex flex-wrap items-start gap-3">
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg border", sovereign ? "border-[color-mix(in_srgb,var(--xch-verified)_45%,transparent)] text-[var(--xch-verified)]" : "border-[var(--xch-line-strong)] text-x-ink/60")}>
            {sovereign ? <Server className="size-4" /> : <Cloud className="size-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-[14px] font-medium text-x-ink">
              {sovereign && <span className="xch-breathe size-2 rounded-full bg-[var(--xch-verified)]" aria-hidden />}
              {sovereign ? t.connected : t.notConnected}
            </p>
            <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-x-ink/50">{sovereign ? t.connectedSub : t.notConnectedSub}</p>
            {!sovereign && (
              <ol className="mt-3 space-y-1.5">
                {t.steps.map((cmd, i) => (
                  <li key={cmd} className="flex items-center gap-2.5">
                    <span className="tnum font-mono text-[10px] text-[var(--xch-verified)]">{String(i + 1).padStart(2, "0")}</span>
                    <code className="min-w-0 truncate rounded-md border border-[var(--xch-line)] bg-x-ink/[0.025] px-2.5 py-1 font-mono text-[11.5px] text-x-ink/80" dir="ltr">
                      {cmd}
                    </code>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <a href="https://github.com/astyboyy-ship-it/bloom-ai/tree/main/deploy/sovereign-node" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-md border border-[var(--xch-line)] px-2.5 py-1 text-[11.5px] text-x-ink/60 hover:text-x-ink">
            <Terminal className="size-3.5" /> {t.docs}
          </a>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel>
          <PanelHeader icon={Fingerprint} title={t.root} />
          <div className="mt-3">
            <Row label="alg" value="Ed25519" />
            <Row label={t.kid} value={<HashDecode text={s.root.kid} />} tone="text-[var(--xch-verified)]" />
            <Row label={t.origin} value={s.root.origin} tone={s.root.origin === "configured" ? "text-[var(--xch-verified)]" : "text-[var(--xch-clamp)]"} />
          </div>
          <p className="mt-3 font-mono text-[9.5px] uppercase tracking-[0.14em] text-x-ink/40">{t.fingerprint}</p>
          <p className="tnum mt-1.5 break-all font-mono text-[11.5px] leading-relaxed text-x-ink/80" dir="ltr">
            {s.root.fingerprint}
          </p>
        </Panel>

        <Panel>
          <PanelHeader icon={s.posture.airGapped ? WifiOff : Wifi} title={t.posture} />
          <div className="mt-3">
            <Row label={t.airGapped} value={yesNo(s.posture.airGapped, true)} />
            <Row label={t.modelEgress} value={yesNo(s.posture.modelEgress, false)} />
            <Row label={t.webhookEgress} value={yesNo(s.posture.webhookEgress, false)} />
            <Row label={t.persistence} value={s.posture.persistence} />
            <Row label={t.database} value={yesNo(s.posture.database, true)} />
          </div>
        </Panel>

        <Panel>
          <PanelHeader icon={Cpu} title={t.hardware} />
          {!hw ? (
            <p className="mt-4 flex items-start gap-2 text-[12px] leading-relaxed text-x-ink/45">
              <Lock className="mt-0.5 size-3.5 shrink-0" /> {t.operatorOnly}
            </p>
          ) : (
            <div className="mt-3">
              <Row label="host" value={hw.hostname} />
              <Row label="os" value={`${hw.platform} · ${hw.arch}`} />
              <Row label={t.cpu} value={`${hw.cpus} × ${hw.cpuModel}`} />
              <div className="border-t border-[var(--xch-line)] py-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-[11.5px] text-x-ink/45">{t.memory}</span>
                  <span className="tnum font-mono text-[11.5px] text-x-ink/85" dir="ltr">
                    {usedMem.toFixed(1)} / {hw.memTotalGb} GB
                  </span>
                </div>
                <div className="relative mt-1.5 h-1 overflow-hidden rounded-full bg-x-ink/[0.06]">
                  <div className="xch-fill absolute inset-0 rounded-full bg-[var(--xch-verified)]" style={{ transform: `scaleX(${hw.memTotalGb ? usedMem / hw.memTotalGb : 0})` }} />
                </div>
              </div>
              <Row label={t.load} value={hw.loadAvg.join(" · ")} />
              <Row label={t.uptime} value={`${hw.uptimeHours} h`} />
              <Row label={t.process} value={`${hw.processRssMb} MB · node ${hw.node}`} />
            </div>
          )}
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          icon={ScrollText}
          title={t.audit}
          right={
            s.audit ? (
              s.audit.chain.intact ? (
                <Badge tone="emerald">
                  <ShieldCheck className="size-3" /> {t.chainIntact} · {s.audit.chain.checked} {t.entries}
                </Badge>
              ) : (
                <Badge tone="rose">
                  <ShieldX className="size-3" /> {t.chainBroken} {s.audit.chain.brokenAt}
                </Badge>
              )
            ) : undefined
          }
        />
        {!s.audit ? (
          <p className="mt-4 flex items-start gap-2 text-[12px] text-x-ink/45">
            <Lock className="mt-0.5 size-3.5 shrink-0" /> {t.operatorOnly}
          </p>
        ) : s.audit.entries.length === 0 ? (
          <p className="mt-4 text-[12px] text-x-ink/45">{t.noAudit}</p>
        ) : (
          <div className="mt-3 xch-scroll overflow-x-auto">
            <table className="tnum w-full min-w-[640px] font-mono text-[11px]">
              <tbody>
                {s.audit.entries.map((e) => (
                  <tr key={e.hash} className={cn("border-t border-[var(--xch-line)] align-top", e.verdict === "quarantined" && "xch-intercept")}>
                    <td className="py-1.5 pe-3 text-x-ink/35">{new Date(e.at).toLocaleTimeString([], { hour12: false })}</td>
                    <td className="py-1.5 pe-3">
                      <Badge tone={e.verdict === "quarantined" ? "rose" : "amber"}>{e.verdict}</Badge>
                    </td>
                    <td className="max-w-[260px] truncate py-1.5 pe-3 text-x-ink/60">{Object.entries(e.vectors).map(([v, n]) => `${v}×${n}`).join(" ")}</td>
                    <td className="py-1.5 pe-3 text-x-ink/45">{e.peer}</td>
                    <td className="py-1.5 text-x-ink/30" dir="ltr">
                      {short(e.prevHash, 8)} → <span className="text-x-ink/60">{short(e.hash, 8)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
