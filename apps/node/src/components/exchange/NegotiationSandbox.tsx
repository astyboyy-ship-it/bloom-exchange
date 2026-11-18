"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, ArrowUpRight, Boxes, Crosshair, Link2, Loader2, Lock, ShieldAlert, ShieldCheck, ShieldX, Swords, Target, type LucideIcon } from "lucide-react";
import { verifyCertificate, type SettlementCertificate as SdkCertificate } from "@bloom-exchange/sdk";
import { effectiveFloor } from "@bloom-exchange/core/types";
import { cn } from "@/lib/utils";
import { useDeskCopy } from "./desk-copy";
import { SCENARIOS, type ScenarioId } from "./scenarios";
import { HashDecode, usd } from "./ui";
import type { Exchange } from "./use-exchange";

const AGENTS: { id: ScenarioId; icon: LucideIcon }[] = [
  { id: "standard", icon: Target },
  { id: "adversarial", icon: Swords },
  { id: "swarm", icon: Boxes },
  { id: "breach", icon: Crosshair },
];

// Twilight garden palette for the stage: deep greens, luminous gold, cream light.
const E = { gold: "#e2bf78", goldSoft: "rgba(226,191,120,0.35)", cream: "rgba(240,236,224,0.88)", creamSoft: "rgba(240,236,224,0.5)", line: "rgba(226,191,120,0.22)", threat: "#ff7a8a", clamp: "#f2a25e" };
const VAULT_YOU = { x: 120, y: 150 };
const VAULT_THEM = { x: 780, y: 150 };
const ENCLAVE = { x: 450, y: 150 };
const LADDER = { x0: 170, x1: 730, y: 300 };

const slug = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "your-agent";

/**
 * The negotiation sandbox: name your agent and its universal link, pick a counterparty agent, set the
 * counterparty's sealed ceiling, then step in. The negotiation is real: an A2A SendStreamingMessage through the
 * gateway, Shield, the double-blind vault and Sovereign, streamed round by round onto the stage, and the
 * resulting BLOOM-XCH certificate is verified with Ed25519 in this browser against the signed Agent Card's keys.
 */
export function NegotiationSandbox({ x, onInspect }: { x: Exchange; onInspect: (taskId: string) => void }) {
  const t = useDeskCopy().sandbox;
  const [name, setName] = useState("acme-cloud-sales");
  const [agent, setAgent] = useState<ScenarioId>("standard");
  const [ceiling, setCeiling] = useState(SCENARIOS.standard.mandate.ceilingPriceUsd);
  const [verdict, setVerdict] = useState<"checking" | "valid" | "invalid" | null>(null);

  const run = x.run;
  const busy = run !== null && (run.state === "submitted" || run.state === "working") && !run.error;
  const floor = effectiveFloor(x.mandate);
  const link = `bloom.exchange/${slug(name)}`;

  const pick = (id: ScenarioId) => {
    setAgent(id);
    setCeiling(SCENARIOS[id].mandate.ceilingPriceUsd);
  };
  const step = () => {
    setVerdict(null);
    void x.fire(agent, { peerName: SCENARIOS[agent].peer.name, ceilingPriceUsd: ceiling });
  };

  // Verify the minted receipt offline, against the keys pinned from the signed Agent Card.
  useEffect(() => {
    if (!run || run.state !== "completed" || !run.taskId || !x.card) return;
    let alive = true;
    setVerdict("checking");
    void x.loadView(run.taskId).then(async (v) => {
      if (!alive) return;
      if (!v?.certificate) return setVerdict("invalid");
      const r = await verifyCertificate(v.certificate as unknown as SdkCertificate, x.card!.keys);
      if (alive) setVerdict(r.valid ? "valid" : "invalid");
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.state, run?.taskId, x.card]);

  const stage = !run ? -1 : run.state === "completed" || run.state === "input_required" || run.state === "failed" ? 3 : run.rounds.length ? 2 : run.taskId ? 1 : 0;
  const blocked = run?.log.some((l) => l.tone === "threat") ?? false;

  return (
    <div className="space-y-5">
      <section className="px-1 pt-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-x-ink/45">{t.kicker}</p>
        <h1 className="xch-display mt-3 text-[34px] leading-[1.05] text-x-ink sm:text-[48px]">
          {t.title} <span className="xch-gold-italic">{t.accent}</span>
        </h1>
        <p className="mt-3 max-w-3xl text-[13.5px] leading-relaxed text-x-ink/55">{t.sub}</p>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        {/* Setup */}
        <section className="xch-card min-w-0 space-y-5 p-5">
          <div>
            <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-x-ink/45">{t.you}</p>
            <label className="mt-2 block">
              <span className="sr-only">{t.name}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} spellCheck={false} className="h-10 w-full rounded-[7px] border border-[var(--xch-line)] bg-[var(--xch-card-solid)] px-4 font-mono text-[13px] text-x-ink outline-none transition-colors focus:border-x-ink/45" aria-label={t.name} />
            </label>
            <a href="/.well-known/agent-card.json" target="_blank" rel="noopener" className="mt-2 flex items-center gap-2 rounded-[7px] border border-[var(--xch-line-strong)] bg-[color-mix(in_srgb,var(--xch-verified)_5%,var(--xch-card-solid))] px-3.5 py-2 text-[12.5px] text-[var(--xch-verified)] transition-colors hover:bg-[color-mix(in_srgb,var(--xch-verified)_10%,var(--xch-card-solid))]">
              <Link2 className="size-3.5 shrink-0" strokeWidth={1.6} />
              <span className="truncate font-mono">{link}</span>
              <ArrowUpRight className="ms-auto size-3.5 shrink-0 opacity-60" />
            </a>
            <p className="mt-1.5 text-[11px] leading-relaxed text-x-ink/45">{t.linkNote}</p>
            <p className="mt-3 flex items-center justify-between gap-2 rounded-[12px] border border-[var(--xch-line)] bg-[var(--xch-card-solid)] px-3.5 py-2.5">
              <span className="flex items-center gap-1.5 text-[12px] text-x-ink/60">
                <Lock className="size-3.5 text-x-ink/45" strokeWidth={1.6} /> {t.floor}
              </span>
              <span className="tnum font-mono text-[13px] text-x-ink">{Number.isFinite(floor) ? usd(floor) : "—"}</span>
            </p>
            <p className="mt-1 text-[11px] text-x-ink/40">{t.floorNote}</p>
          </div>

          <div>
            <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-x-ink/45">{t.counterparty}</p>
            <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-1">
              {AGENTS.map((a) => (
                <button key={a.id} type="button" disabled={busy} onClick={() => pick(a.id)} aria-pressed={agent === a.id} className={cn("flex min-w-0 items-center gap-2.5 rounded-[12px] border px-3 py-2 text-start transition-colors duration-150 disabled:opacity-50", agent === a.id ? "border-x-ink/45 bg-[var(--xch-card-solid)] shadow-[0_1px_3px_rgba(40,25,20,0.08)]" : "border-[var(--xch-line)] bg-[var(--xch-card-solid)]/50 hover:bg-[var(--xch-card-solid)]")}>
                  <a.icon className={cn("size-4 shrink-0", a.id === "adversarial" ? "text-[var(--xch-threat)]" : a.id === "breach" ? "text-[var(--xch-clamp)]" : "text-x-ink/45")} strokeWidth={1.5} />
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] text-x-ink">{t.agents[a.id]}</span>
                    <span className="block truncate font-mono text-[10.5px] text-x-ink/45">bloom.exchange/{SCENARIOS[a.id].peer.name}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="flex items-baseline justify-between gap-2">
              <span className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.18em] text-x-ink/45">
                <Lock className="size-3 text-x-ink/45" strokeWidth={1.6} /> {t.ceiling}
              </span>
              <span className="tnum font-mono text-[13px] text-x-ink">{usd(ceiling)}</span>
            </span>
            <input type="range" min={20_000} max={90_000} step={500} value={ceiling} disabled={busy} onChange={(e) => setCeiling(Number(e.target.value))} className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-x-ink/[0.07] [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-x-ink [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-x-ink [&::-webkit-slider-thumb]:shadow-[0_1px_3px_rgba(40,25,20,0.35)]" aria-label={t.ceiling} />
            <span className="mt-1 block text-[11px] text-x-ink/40">{t.ceilingNote}</span>
          </label>

          <button type="button" disabled={busy} onClick={step} className="xch-btn-ink flex h-12 w-full items-center justify-center gap-2 text-[14px] font-medium disabled:opacity-60">
            {busy ? <Loader2 className="size-4 animate-spin" /> : null} {busy ? t.running : run ? t.again : t.step} {!busy && <ArrowRight className="size-4" strokeWidth={1.75} />}
          </button>
        </section>

        {/* The stage: a twilight garden, framed */}
        <section className="min-w-0 rounded-[18px] bg-[var(--xch-card-solid)] p-2.5 shadow-[0_2px_4px_rgba(40,25,20,0.05),0_40px_80px_-44px_rgba(40,25,20,0.4)] ring-1 ring-[var(--xch-line)] sm:p-3">
          <div className="relative overflow-hidden rounded-[12px] bg-[radial-gradient(120%_90%_at_50%_10%,#3a4229_0%,#242a1a_55%,#14170e_100%)] ring-1 ring-[var(--xch-line-strong)]">
            <Image src="/paintings/villa-deste.jpg" alt="" fill sizes="(min-width: 1280px) 900px, 100vw" quality={75} className="object-cover opacity-[0.16] saturate-[0.35]" />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_45%,rgba(226,191,120,0.14),transparent_70%)]" aria-hidden />

            <ol className="relative flex flex-wrap gap-x-5 gap-y-1 px-4 pt-3.5 sm:px-5">
              {t.stages.map((s, i) => (
                <li key={s} className={cn("flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.16em] transition-colors duration-300", i <= stage ? "text-[#e2bf78]" : "text-[rgba(240,236,224,0.35)]")}>
                  <span className={cn("size-1.5 rounded-full transition-colors duration-300", i <= stage ? "bg-[#e2bf78]" : "bg-[rgba(240,236,224,0.25)]")} /> {s}
                </li>
              ))}
            </ol>

            <div className="xch-noscroll relative overflow-x-auto">
              <Stage run={run} labels={t} you={slug(name)} them={SCENARIOS[agent].peer.name} />
            </div>

            <div className="relative min-h-[64px] border-t border-[rgba(226,191,120,0.18)] px-4 py-3 sm:px-5">
              <AnimatePresence mode="wait">
                <motion.div key={`${run?.state ?? "idle"}-${verdict}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px]">
                  {!run && <p className="text-[rgba(240,236,224,0.6)]">{t.idle}</p>}
                  {run?.error && <p className="text-[#ff7a8a]">{run.error}</p>}
                  {run && blocked && (
                    <p className="flex items-center gap-1.5 text-[#ff7a8a]">
                      <ShieldAlert className="size-3.5" /> {t.blocked}
                    </p>
                  )}
                  {run?.state === "input_required" && <p className="text-[#f2a25e]">{t.held}</p>}
                  {run?.certificateId && (
                    <>
                      <span className="font-mono text-[13px] text-[#e2bf78]">
                        <HashDecode text={run.certificateId} />
                      </span>
                      <span className={cn("flex items-center gap-1.5 font-mono text-[11px]", verdict === "valid" ? "text-[#e2bf78]" : verdict === "invalid" ? "text-[#ff7a8a]" : "text-[rgba(240,236,224,0.6)]")}>
                        {verdict === "valid" ? <ShieldCheck className="size-3.5" /> : verdict === "invalid" ? <ShieldX className="size-3.5" /> : <Loader2 className="size-3.5 animate-spin" />}
                        {verdict === "valid" ? t.verified : verdict === "invalid" ? t.failed : t.verifying}
                      </span>
                    </>
                  )}
                  {run?.taskId && !busy && (
                    <button type="button" onClick={() => onInspect(run.taskId!)} className="ms-auto flex items-center gap-1 rounded-[7px] border border-[rgba(226,191,120,0.4)] px-3 py-1 text-[11.5px] text-[#e2bf78] transition-colors hover:bg-[rgba(226,191,120,0.1)]">
                      {t.inspect} <ArrowUpRight className="size-3.5" />
                    </button>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

type SandboxLabels = ReturnType<typeof useDeskCopy>["sandbox"];

/** Vaults, the enclave and a price ladder; every packet is a real round as it streams in. */
function Stage({ run, labels: t, you, them }: { run: Exchange["run"]; labels: SandboxLabels; you: string; them: string }) {
  const rounds = useMemo(() => run?.rounds ?? [], [run?.rounds]);
  const last = rounds[rounds.length - 1];
  const prices = rounds.map((r) => r.terms.priceUsd);
  const lo = prices.length ? Math.min(...prices) : 0;
  const hi = prices.length ? Math.max(...prices) : 1;
  const px = (p: number) => LADDER.x0 + ((p - lo) / Math.max(1, hi - lo)) * (LADDER.x1 - LADDER.x0);
  const settled = run?.state === "completed";
  const held = run?.state === "input_required";
  const final = settled && last ? last.terms.priceUsd : null;
  const lastBy = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rounds) m[r.by] = r.terms.priceUsd;
    return m;
  }, [rounds]);

  return (
    <svg viewBox="0 0 900 340" className="block h-auto w-full min-w-[620px]" role="img" aria-label={t.enclave}>
      {/* Paths from each vault into the enclave */}
      <path d={`M${VAULT_YOU.x + 34} ${VAULT_YOU.y} C300 ${VAULT_YOU.y - 50} 340 ${ENCLAVE.y} ${ENCLAVE.x - 92} ${ENCLAVE.y}`} fill="none" stroke={E.line} strokeWidth={1.2} />
      <path d={`M${VAULT_THEM.x - 34} ${VAULT_THEM.y} C600 ${VAULT_THEM.y - 50} 560 ${ENCLAVE.y} ${ENCLAVE.x + 92} ${ENCLAVE.y}`} fill="none" stroke={E.line} strokeWidth={1.2} />

      {/* The enclave */}
      <circle cx={ENCLAVE.x} cy={ENCLAVE.y} r={92} fill="rgba(226,191,120,0.05)" stroke={E.goldSoft} strokeDasharray="2 6" />
      <circle cx={ENCLAVE.x} cy={ENCLAVE.y} r={104} fill="none" stroke={held ? E.clamp : "rgba(255,122,138,0.22)"} />
      <text x={ENCLAVE.x} y={ENCLAVE.y - 112} textAnchor="middle" fontSize={9.5} fill={E.creamSoft} letterSpacing="0.16em" className="font-mono">
        {t.enclave.toUpperCase()}
      </text>
      <text x={ENCLAVE.x} y={ENCLAVE.y - 6} textAnchor="middle" fontSize={30} fill={settled ? E.gold : E.cream} className="tnum font-mono">
        {rounds.length}
      </text>
      <text x={ENCLAVE.x} y={ENCLAVE.y + 14} textAnchor="middle" fontSize={9.5} fill={E.creamSoft} className="font-mono">
        {t.rounds}
      </text>
      {final !== null && (
        <motion.text x={ENCLAVE.x} y={ENCLAVE.y + 42} textAnchor="middle" fontSize={15} fill={E.gold} className="tnum font-mono" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          {usd(final)}
        </motion.text>
      )}
      {settled && (
        <motion.circle cx={ENCLAVE.x} cy={ENCLAVE.y} fill="none" stroke={E.gold} strokeWidth={1.4} initial={{ r: 40, opacity: 0.9 }} animate={{ r: 130, opacity: 0 }} transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }} />
      )}

      {/* Vaults */}
      {[
        { at: VAULT_YOU, title: t.vaultYou, who: you },
        { at: VAULT_THEM, title: t.vaultThem, who: them },
      ].map((v) => (
        <g key={v.title}>
          <circle cx={v.at.x} cy={v.at.y} r={34} fill="rgba(20,23,14,0.7)" stroke={E.gold} strokeWidth={1.2} />
          <rect x={v.at.x - 8} y={v.at.y - 4} width={16} height={13} rx={2.5} fill="none" stroke={E.gold} strokeWidth={1.3} />
          <path d={`M${v.at.x - 4.5} ${v.at.y - 4} v-4 a4.5 4.5 0 0 1 9 0 v4`} fill="none" stroke={E.gold} strokeWidth={1.3} />
          <text x={v.at.x} y={v.at.y + 52} textAnchor="middle" fontSize={11} fill={E.cream}>
            {v.title}
          </text>
          <text x={v.at.x} y={v.at.y + 66} textAnchor="middle" fontSize={9} fill={E.creamSoft} className="font-mono">
            {v.who.length > 22 ? `${v.who.slice(0, 21)}…` : v.who} · {t.sealed}
          </text>
        </g>
      ))}

      {/* The latest round travels from its vault into the enclave */}
      <AnimatePresence>
        {last && !settled && (
          <motion.rect key={last.n} width={10} height={7} rx={2} fill={last.by === "initiator" ? E.gold : E.cream} initial={{ x: (last.by === "initiator" ? VAULT_YOU.x + 34 : VAULT_THEM.x - 44) - 0, y: ENCLAVE.y - 3.5, opacity: 0 }} animate={{ x: last.by === "initiator" ? ENCLAVE.x - 100 : ENCLAVE.x + 90, opacity: [0, 1, 1, 0] }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }} />
        )}
      </AnimatePresence>

      {/* Price ladder: every offer as a tick; the two sides converge */}
      <line x1={LADDER.x0} x2={LADDER.x1} y1={LADDER.y} y2={LADDER.y} stroke={E.line} />
      {rounds.map((r) => (
        <motion.line key={r.n} x1={px(r.terms.priceUsd)} x2={px(r.terms.priceUsd)} y1={LADDER.y - 6} y2={LADDER.y + 6} stroke={r.by === "initiator" ? E.gold : E.cream} strokeOpacity={0.45} initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
      ))}
      {(["initiator", "counterparty"] as const).map((side) =>
        lastBy[side] !== undefined ? (
          <motion.g key={side} initial={false} animate={{ x: px(lastBy[side]) }} transition={{ type: "spring", visualDuration: 0.35, bounce: 0.15 }}>
            <circle cx={0} cy={LADDER.y} r={6} fill={side === "initiator" ? E.gold : E.cream} />
            <text x={0} y={side === "initiator" ? LADDER.y - 14 : LADDER.y + 22} textAnchor="middle" fontSize={10} fill={side === "initiator" ? E.gold : E.cream} className="tnum font-mono">
              {usd(lastBy[side])}
            </text>
          </motion.g>
        ) : null,
      )}
      <text x={LADDER.x0} y={LADDER.y + 34} fontSize={9} fill={E.creamSoft} className="font-mono">
        ● {t.yourOffer}
      </text>
      <text x={LADDER.x1} y={LADDER.y + 34} textAnchor="end" fontSize={9} fill={E.creamSoft} className="font-mono">
        {t.theirOffer} ●
      </text>
    </svg>
  );
}
