"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Radar as RadarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { PARLIAMENT_NODES, Panel, PanelHeader } from "./ui";
import { useExchangeCopy } from "./copy";
import type { TrafficItem, TrafficKind } from "./use-exchange";

const W = 720;
const H = 280;
const ENCLAVE = { x: 360, y: 140 };
const engineY = (i: number) => 40 + i * 50;
const ENGINE_X = 628;
const PEER_X = 92;

// Semantic only: emerald = settled, amber = clamped/escalated, rose = threat. Everything else stays neutral.
const COLOR: Record<TrafficKind, string> = { handshake: "rgba(22,17,15,0.75)", round: "rgba(22,17,15,0.45)", blocked: "var(--xch-threat)", exception: "var(--xch-clamp)", settled: "var(--xch-verified)", rejected: "var(--xch-threat)" };
export const KIND_CLASS: Record<TrafficKind, string> = {
  handshake: "border-[var(--xch-line-strong)] text-x-ink/70",
  round: "border-[var(--xch-line)] text-x-ink/45",
  blocked: "border-[color-mix(in_srgb,var(--xch-threat)_45%,transparent)] text-[var(--xch-threat)]",
  exception: "border-[color-mix(in_srgb,var(--xch-clamp)_45%,transparent)] text-[var(--xch-clamp)]",
  settled: "border-[color-mix(in_srgb,var(--xch-verified)_45%,transparent)] text-[var(--xch-verified)]",
  rejected: "border-[color-mix(in_srgb,var(--xch-threat)_45%,transparent)] text-[var(--xch-threat)]",
};

type Packet = { id: string; from: { x: number; y: number }; to: { x: number; y: number }; color: string };

export function TrafficRadar({ traffic, className }: { traffic: TrafficItem[]; className?: string }) {
  const t = useExchangeCopy().radar;
  const peers = useMemo(() => [...new Set(traffic.map((x) => x.peer))].slice(0, 5), [traffic]);
  const peerY = (name: string) => {
    const i = Math.max(0, peers.indexOf(name));
    const n = Math.max(1, peers.length);
    return n === 1 ? ENCLAVE.y : 56 + (i * (H - 112)) / (n - 1);
  };
  const engine = (key: string) => ({ x: ENGINE_X, y: engineY(PARLIAMENT_NODES.findIndex((e) => e.engine === key)) });

  const [packets, setPackets] = useState<Packet[]>([]);
  const [hot, setHot] = useState<string | null>(null);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const fresh = traffic.filter((x) => !seen.current.has(x.id)).slice(0, 6);
    if (!fresh.length) return;
    fresh.forEach((x) => seen.current.add(x.id));
    const made: Packet[] = fresh.map((x) => {
      const peer = { x: PEER_X, y: peerY(x.peer) };
      const route =
        x.kind === "blocked" ? [peer, engine("shield")] : x.kind === "settled" || x.kind === "exception" || x.kind === "rejected" ? [ENCLAVE, engine("sovereign")] : x.kind === "round" && /provider/.test(x.detail) ? [engine("apex"), ENCLAVE] : [peer, ENCLAVE];
      return { id: x.id, from: route[0], to: route[1], color: COLOR[x.kind] };
    });
    const intercept = fresh.find((x) => x.kind === "blocked" || x.kind === "settled");
    if (intercept) setHot(intercept.kind);
    setPackets((p) => [...p, ...made].slice(-14));
    const ids = new Set(made.map((m) => m.id));
    const timer = setTimeout(() => {
      setPackets((p) => p.filter((x) => !ids.has(x.id)));
      setHot(null);
    }, 1100);
    return () => clearTimeout(timer);
    // peerY/engine derive from `peers`, which only changes with `traffic`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traffic]);

  const enclaveStroke = hot === "blocked" ? "var(--xch-threat)" : "var(--xch-verified)";

  return (
    <Panel className={className}>
      <PanelHeader icon={RadarIcon} title={t.title} sub={t.sub} />
      <div className="mt-3 overflow-hidden rounded-[10px] border border-[var(--xch-line)] bg-x-ink/[0.025]">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={t.title}>
          <defs>
            <radialGradient id="xch-sweep" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#7a5c1e" stopOpacity="0.1" />
              <stop offset="1" stopColor="#7a5c1e" stopOpacity="0" />
            </radialGradient>
          </defs>
          {[46, 92, 132].map((r) => (
            <circle key={r} cx={ENCLAVE.x} cy={ENCLAVE.y} r={r} fill="none" stroke="rgba(120,88,30,0.18)" strokeDasharray="2 5" />
          ))}
          <g className="xch-sweep" style={{ transformOrigin: `${ENCLAVE.x}px ${ENCLAVE.y}px` }}>
            <path d={`M${ENCLAVE.x} ${ENCLAVE.y} L${ENCLAVE.x + 132} ${ENCLAVE.y} A132 132 0 0 0 ${ENCLAVE.x + 132 * Math.cos(-0.6)} ${ENCLAVE.y + 132 * Math.sin(-0.6)} Z`} fill="url(#xch-sweep)" />
          </g>
          {peers.map((p) => (
            <line key={p} x1={PEER_X} y1={peerY(p)} x2={ENCLAVE.x - 30} y2={ENCLAVE.y} stroke="rgba(120,88,30,0.22)" />
          ))}
          {PARLIAMENT_NODES.map((e, i) => (
            <line key={e.engine} x1={ENCLAVE.x + 30} y1={ENCLAVE.y} x2={ENGINE_X} y2={engineY(i)} stroke="rgba(120,88,30,0.22)" />
          ))}
          <motion.path d={hexPath(ENCLAVE.x, ENCLAVE.y, 30)} fill="#faf8f4" stroke={enclaveStroke} strokeWidth={1} animate={{ strokeOpacity: hot ? 1 : 0.6 }} transition={{ duration: 0.3 }} />
          <text x={ENCLAVE.x} y={ENCLAVE.y + 3} textAnchor="middle" className="font-mono" fill="#7a5c1e" fontSize={8} letterSpacing="0.12em">
            ENCLAVE
          </text>
          <text x={ENCLAVE.x} y={ENCLAVE.y + 48} textAnchor="middle" className="font-mono uppercase" fill="rgba(22,17,15,0.45)" fontSize={8} letterSpacing="0.18em">
            {t.enclave}
          </text>
          <text x={PEER_X} y={18} textAnchor="middle" className="font-mono uppercase" fill="rgba(22,17,15,0.45)" fontSize={8} letterSpacing="0.18em">
            {t.peers}
          </text>
          {peers.map((p) => (
            <g key={p}>
              <circle cx={PEER_X} cy={peerY(p)} r={4.5} fill="#fdfcfa" stroke="rgba(22,17,15,0.7)" />
              <text x={PEER_X} y={peerY(p) + 16} textAnchor="middle" className="font-mono" fill="rgba(22,17,15,0.55)" fontSize={8}>
                {p.length > 22 ? `${p.slice(0, 21)}…` : p}
              </text>
            </g>
          ))}
          <text x={ENGINE_X} y={18} textAnchor="middle" className="font-mono uppercase" fill="rgba(22,17,15,0.45)" fontSize={8} letterSpacing="0.18em">
            {t.parliament}
          </text>
          {PARLIAMENT_NODES.map((e, i) => (
            <g key={e.engine}>
              <rect x={ENGINE_X - 34} y={engineY(i) - 9} width={68} height={18} rx={4} fill="#faf8f4" stroke={(hot === "blocked" && e.engine === "shield") || (hot === "settled" && e.engine === "sovereign") ? COLOR[hot as TrafficKind] : "rgba(120,88,30,0.3)"} />
              <text x={ENGINE_X} y={engineY(i) + 3} textAnchor="middle" className="font-mono uppercase" fill="rgba(22,17,15,0.72)" fontSize={8} letterSpacing="0.14em">
                {e.label}
              </text>
            </g>
          ))}
          <AnimatePresence>
            {packets.map((p) => (
              <motion.circle key={p.id} r={2.8} fill={p.color} initial={{ cx: p.from.x, cy: p.from.y, opacity: 0 }} animate={{ cx: p.to.x, cy: p.to.y, opacity: [0, 1, 1, 0] }} exit={{ opacity: 0 }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
            ))}
          </AnimatePresence>
        </svg>
      </div>

      <ol className="mt-3 max-h-[176px] space-y-px xch-scroll overflow-y-auto pe-1 font-mono text-[10.5px]" aria-live="polite">
        {traffic.length === 0 && <li className="py-3 text-center text-x-ink/35">{t.empty}</li>}
        {traffic.slice(0, 30).map((x) => (
          <li key={x.id} className={cn("xch-row-in grid grid-cols-[62px_82px_minmax(0,140px)_1fr] items-center gap-2 rounded-md px-1.5 py-1 hover:bg-x-ink/[0.025]", x.kind === "settled" && "xch-flash", x.kind === "blocked" && "xch-intercept")}>
            <span className="tnum text-x-ink/35" dir="ltr">
              {new Date(x.at).toLocaleTimeString([], { hour12: false })}
            </span>
            <span className={cn("w-fit rounded border px-1.5 py-px text-[8.5px] uppercase tracking-[0.12em]", KIND_CLASS[x.kind])}>{t.kinds[x.kind]}</span>
            <span className="truncate text-x-ink/70">{x.peer}</span>
            <span className="tnum truncate text-x-ink/45" dir="ltr">
              {x.detail}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function hexPath(cx: number, cy: number, r: number) {
  return (
    Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      return `${i ? "L" : "M"}${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
    }).join(" ") + " Z"
  );
}
