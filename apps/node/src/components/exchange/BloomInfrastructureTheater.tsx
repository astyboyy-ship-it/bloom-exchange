"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOmniCopy } from "./omni-copy";
import { Badge, SPRING } from "./ui";

/**
 * How Bloom ends agent chaos, in four steps and Bloom's white-gallery palette: (1) a company's AI stack orchestrated under
 * one sovereign, fed by ground truth and clamped in code; (2) a Bloom link met anywhere (email, DMs, APIs) that
 * moves the conversation out of the human thread into a double-blind sandbox; (3) intents tested against both
 * sealed mandates at machine speed, no-fit buyers held at the bound; (4) one-click sign-off for each owner and a
 * BLOOM-XCH Ed25519 receipt. An illustration (labelled as one). Motion is native SVG (<animateMotion>/<animate>),
 * the step timer a CSS animation whose end advances the step, so React never re-renders per frame. Reduced
 * motion freezes scenes and disables auto-advance.
 */
const STEP_SECONDS = 9;
const GOLD = "#7a5c1e";
const CRIMSON = "#9f1239";
const THREAT = "#a3122f";
const CREAM = "rgba(22,17,15,0.82)";
const LINE = "rgba(120,88,30,0.16)";
const CARD = "#fdfbf5";
type Labels = {
  core: string;
  truth: string;
  clamped: string;
  agents: string[];
  channels: string[];
  link: string;
  human: string;
  sandbox: string;
  budget: string;
  capability: string;
  intent: string;
  held: string;
  matched: string;
  provider: string;
  client: string;
  approve: string;
  approved: string;
  receipt: string;
};

const Defs = () => (
  <defs>
    <radialGradient id="xch-velvet" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stopColor="#9f1239" stopOpacity="0.14" />
      <stop offset="0.6" stopColor="#9f1239" stopOpacity="0.05" />
      <stop offset="1" stopColor="#fdfcfa" stopOpacity="0" />
    </radialGradient>
    <radialGradient id="xch-gold-glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stopColor="#d6aa5c" stopOpacity="0.28" />
      <stop offset="1" stopColor="#d6aa5c" stopOpacity="0" />
    </radialGradient>
  </defs>
);

const Mono = ({ x, y, size = 10, fill = CREAM, anchor = "start", children, spacing }: { x: number; y: number; size?: number; fill?: string; anchor?: "start" | "middle" | "end"; children: React.ReactNode; spacing?: string }) => (
  <text x={x} y={y} fontSize={size} fill={fill} textAnchor={anchor} letterSpacing={spacing} className="font-mono">
    {children}
  </text>
);

/* Step 1: the stack under one sovereign. Ground truth flows into the core, the core briefs every agent, and an
   out-of-mandate figure is stopped at the guardrail ring. */
const AGENT_POS = [
  { x: 112, y: 92 },
  { x: 112, y: 178 },
  { x: 112, y: 264 },
  { x: 688, y: 92 },
  { x: 688, y: 178 },
  { x: 688, y: 264 },
];

function StackScene({ l }: { l: Labels }) {
  const core = { x: 400, y: 186 };
  return (
    <svg viewBox="0 0 800 320" className="block h-auto w-full" role="img" aria-label={l.core}>
      <Defs />
      <circle cx={core.x} cy={core.y} r={120} fill="url(#xch-velvet)">
      </circle>
      {/* Guardrail ring: the standing mandate, enforced in code */}
      <ellipse cx={core.x} cy={core.y} rx={128} ry={92} fill="none" stroke={THREAT} strokeOpacity={0.4} strokeDasharray="3 6">
      </ellipse>

      {/* Ground truth feed */}
      <rect x={330} y={14} width={140} height={30} rx={15} fill={CARD} stroke="rgba(120,88,30,0.4)" />
      <Mono x={400} y={33} anchor="middle" fill={GOLD} size={10} spacing="0.08em">
        {l.truth}
      </Mono>
      <path d={`M400 44 L400 ${core.y - 34}`} stroke={GOLD} strokeOpacity={0.25} strokeDasharray="2 4" />
      {[0, 1, 2].map((i) => (
        <rect key={i} x={-3} y={-2} width={6} height={4} rx={1} fill={GOLD}>
          <animateMotion dur="1.8s" begin={`${i * 0.6}s`} repeatCount="indefinite" path={`M400 46 L400 ${core.y - 34}`} />
        </rect>
      ))}

      {/* Core → agents */}
      {AGENT_POS.map((a, i) => {
        const left = a.x < core.x;
        const ax = a.x + (left ? 66 : -66);
        const d = `M${core.x + (left ? -34 : 34)} ${core.y} C${(core.x + ax) / 2} ${core.y} ${(core.x + ax) / 2} ${a.y} ${ax} ${a.y}`;
        return (
          <g key={i}>
            <path d={d} fill="none" stroke={GOLD} strokeOpacity={0.18} />
            <circle r={2.4} fill={GOLD}>
              <animateMotion dur="2.4s" begin={`${0.3 + i * 0.37}s`} repeatCount="indefinite" path={d} />
              <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur="2.4s" begin={`${0.3 + i * 0.37}s`} repeatCount="indefinite" />
            </circle>
            <rect x={a.x - 66} y={a.y - 17} width={132} height={34} rx={10} fill={CARD} stroke="rgba(120,88,30,0.24)" />
            <circle cx={a.x - 50} cy={a.y} r={3.5} fill={GOLD}>
              <animate attributeName="opacity" values="0.4;1;0.4" dur="2.4s" begin={`${0.3 + i * 0.37 + 2}s`} repeatCount="indefinite" />
            </circle>
            <Mono x={a.x - 38} y={a.y + 4} size={10.5}>
              {l.agents[i]}
            </Mono>
          </g>
        );
      })}

      {/* An errant figure heads past the mandate and is clamped at the ring */}
      <circle r={3.4} fill={THREAT}>
        <animateMotion dur="4s" repeatCount="indefinite" path={`M${core.x + 20} ${core.y - 20} L${core.x + 92} ${core.y - 66}`} keyPoints="0;1;1" keyTimes="0;0.4;1" calcMode="linear" />
        <animate attributeName="fill" values={`${THREAT};${THREAT};${GOLD};${GOLD}`} keyTimes="0;0.4;0.42;1" dur="4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.05;0.7;0.8" dur="4s" repeatCount="indefinite" />
      </circle>
      <circle cx={core.x + 92} cy={core.y - 66} r={4} fill="none" stroke={GOLD} opacity={0}>
        <animate attributeName="r" values="4;4;16" keyTimes="0;0.4;0.62" dur="4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;0;0.9;0" keyTimes="0;0.4;0.42;0.62" dur="4s" repeatCount="indefinite" />
      </circle>
      <g opacity={0}>
        <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.4;0.45;0.75;0.85" dur="4s" repeatCount="indefinite" />
        <Mono x={core.x + 104} y={core.y - 70} size={9.5} fill={GOLD}>
          {l.clamped}
        </Mono>
      </g>

      {/* The sovereign core */}
      <circle cx={core.x} cy={core.y} r={56} fill="url(#xch-gold-glow)" />
      <circle cx={core.x} cy={core.y} r={34} fill={CARD} stroke={GOLD} strokeOpacity={0.75} />
      <circle cx={core.x} cy={core.y} r={26} fill="none" stroke={GOLD} strokeOpacity={0.3} strokeDasharray="1 4">
      </circle>
      <path d={ROSE_MARK} transform={`translate(${core.x} ${core.y}) scale(0.9)`} fill={CRIMSON} opacity={0.9} />
      <Mono x={core.x} y={core.y + 56} anchor="middle" size={9.5} fill="rgba(120,88,30,0.8)" spacing="0.14em">
        {l.core.toUpperCase()}
      </Mono>
    </svg>
  );
}

// A small five-petal rose mark, centered at the origin.
const ROSE_MARK = Array.from({ length: 5 }, (_, i) => {
  const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
  const x = Math.cos(a) * 9;
  const y = Math.sin(a) * 9;
  const cx1 = Math.cos(a - 0.7) * 14;
  const cy1 = Math.sin(a - 0.7) * 14;
  const cx2 = Math.cos(a + 0.7) * 14;
  const cy2 = Math.sin(a + 0.7) * 14;
  return `M0 0 Q${cx1.toFixed(1)} ${cy1.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)} Q${cx2.toFixed(1)} ${cy2.toFixed(1)} 0 0 Z`;
}).join(" ");

/* Step 2: a Bloom link met anywhere. The human thread crawls along the bottom; the link takes the gold lane into
   the double-blind sandbox, where both sides arrive sealed. */
function LinkScene({ l }: { l: Labels }) {
  const sandbox = { x: 600, y: 150 };
  const cy = (i: number) => 52 + i * 66;
  const human = "M190 300 L760 300";
  return (
    <svg viewBox="0 0 800 320" className="block h-auto w-full" role="img" aria-label={l.sandbox}>
      <Defs />
      <circle cx={sandbox.x} cy={sandbox.y} r={130} fill="url(#xch-velvet)">
      </circle>
      <circle cx={sandbox.x} cy={sandbox.y} r={92} fill="none" stroke={GOLD} strokeOpacity={0.45} strokeDasharray="2 6">
      </circle>
      <circle cx={sandbox.x} cy={sandbox.y} r={104} fill="none" stroke={THREAT} strokeOpacity={0.22} />

      {l.channels.map((ch, i) => {
        const y = cy(i);
        const d = `M192 ${y} C340 ${y} 420 ${sandbox.y + (i - 1.5) * 18} ${sandbox.x - 40} ${sandbox.y + (i - 1.5) * 18}`;
        const begin = `${0.4 + i * 0.6}s`;
        return (
          <g key={ch}>
            <path d={d} fill="none" stroke={GOLD} strokeWidth={1.2} pathLength={1} strokeDasharray="1" strokeDashoffset="1" strokeOpacity={0.5}>
              <animate attributeName="stroke-dashoffset" values="1;0;0" keyTimes="0;0.2;1" dur="5s" begin={begin} repeatCount="indefinite" />
            </path>
            <rect width={8} height={6} x={-4} y={-3} rx={1.2} fill={GOLD}>
              <animateMotion dur="1.6s" begin={begin} repeatCount="indefinite" path={d} />
            </rect>
            <rect x={22} y={y - 21} width={168} height={42} rx={10} fill={CARD} stroke="rgba(120,88,30,0.22)" />
            <Mono x={36} y={y - 3} size={10.5}>
              {ch}
            </Mono>
            <rect x={36} y={y + 5} width={84} height={13} rx={6.5} fill="rgba(225,29,72,0.16)" stroke="rgba(255,92,116,0.5)" />
            <Mono x={78} y={y + 14.5} size={8} anchor="middle" fill="#9f1239">
              {l.link}
            </Mono>
          </g>
        );
      })}

      {/* The human thread: slow, dashed, never arriving within the frame */}
      <path d={human} fill="none" stroke="rgba(22,17,15,0.18)" strokeDasharray="2 7" />
      <circle r={3} fill="rgba(22,17,15,0.55)">
        <animateMotion dur="14s" repeatCount="indefinite" path={human} />
      </circle>
      <Mono x={200} y={292} size={8.5} fill="rgba(22,17,15,0.4)">
        {l.human}
      </Mono>

      {/* Inside the sandbox: both sides sealed */}
      {[-1, 1].map((s) => (
        <g key={s}>
          <rect x={sandbox.x - 9 + s * 26} y={sandbox.y - 6} width={18} height={14} rx={3} fill="none" stroke={GOLD} />
          <path d={`M${sandbox.x - 5 + s * 26} ${sandbox.y - 6} v-5 a5 5 0 0 1 10 0 v5`} fill="none" stroke={GOLD} />
        </g>
      ))}
      <circle cx={sandbox.x} cy={sandbox.y + 1} r={4} fill={GOLD}>
        <animate attributeName="opacity" values="0.3;1;0.3" dur="2s" repeatCount="indefinite" />
      </circle>
      <Mono x={sandbox.x} y={sandbox.y + 40} anchor="middle" size={9} fill="rgba(120,88,30,0.8)" spacing="0.14em">
        {l.sandbox.toUpperCase()}
      </Mono>
    </svg>
  );
}

/* Step 3: intent matching. Each buyer runs its own lane through three deterministic gates; no-fit buyers stop at
   the bound in crimson, real ones clear into the match. */
const BUYERS = [
  { stop: 0 },
  { stop: -1 },
  { stop: 1 },
  { stop: 2 },
  { stop: -1 },
  { stop: 0 },
];
const GATES = [300, 410, 520];

function MatchScene({ l }: { l: Labels }) {
  const by = (i: number) => 42 + i * 46;
  const target = { x: 700, y: 157 };
  const gateNames = [l.budget, l.capability, l.intent];
  return (
    <svg viewBox="0 0 800 320" className="block h-auto w-full" role="img" aria-label={l.matched}>
      <Defs />
      {GATES.map((gx, g) => (
        <g key={gx}>
          <line x1={gx} x2={gx} y1={22} y2={292} stroke={GOLD} strokeOpacity={0.35} strokeDasharray="2 4" />
          <Mono x={gx} y={310} anchor="middle" size={9} fill="rgba(120,88,30,0.75)" spacing="0.08em">
            {gateNames[g]}
          </Mono>
        </g>
      ))}
      <circle cx={target.x} cy={target.y} r={70} fill="url(#xch-gold-glow)" />
      <rect x={target.x - 54} y={target.y - 22} width={108} height={44} rx={12} fill={CARD} stroke={GOLD} strokeOpacity={0.75} />
      <Mono x={target.x} y={target.y + 4} anchor="middle" size={10.5} fill={GOLD}>
        {l.matched}
      </Mono>

      {BUYERS.map((b, i) => {
        const y = by(i);
        const straight = 600 - 150;
        const tail = Math.hypot(target.x - 54 - 600, target.y - y);
        const d = `M150 ${y} L600 ${y} L${target.x - 54} ${target.y}`;
        const held = b.stop >= 0;
        const stopAt = held ? (GATES[b.stop] - 150) / (straight + tail) : 1;
        const dur = 3.6;
        const begin = `${i * 0.45}s`;
        return (
          <g key={i}>
            <path d={`M150 ${y} L${held ? GATES[b.stop] : 600} ${y}`} stroke={held ? "rgba(193,17,49,0.12)" : "rgba(120,88,30,0.16)"} />
            {!held && <path d={`M600 ${y} L${target.x - 54} ${target.y}`} stroke="rgba(120,88,30,0.16)" fill="none" />}
            <rect x={22} y={y - 14} width={128} height={28} rx={14} fill={CARD} stroke={LINE} />
            <Mono x={86} y={y + 3.5} anchor="middle" size={9.5}>
              {`buyer · 0${i + 1}`}
            </Mono>
            <circle r={3.4} fill={GOLD}>
              <animateMotion dur={`${dur}s`} begin={begin} repeatCount="indefinite" path={d} keyPoints={`0;${stopAt.toFixed(3)};${stopAt.toFixed(3)}`} keyTimes="0;0.45;1" calcMode="linear" />
              {held && <animate attributeName="fill" values={`${GOLD};${GOLD};${THREAT};${THREAT}`} keyTimes="0;0.45;0.47;1" dur={`${dur}s`} begin={begin} repeatCount="indefinite" />}
              <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.05;0.8;0.95" dur={`${dur}s`} begin={begin} repeatCount="indefinite" />
            </circle>
            {held && (
              <g opacity={0}>
                <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.45;0.5;0.8;0.95" dur={`${dur}s`} begin={begin} repeatCount="indefinite" />
                <rect x={GATES[b.stop] - 3} y={y - 9} width={6} height={18} rx={2} fill={THREAT} opacity={0.75} />
                <Mono x={GATES[b.stop] + 10} y={y + 3.5} size={8.5} fill="rgba(193,17,49,0.9)">
                  {l.held}
                </Mono>
              </g>
            )}
          </g>
        );
      })}
      <Mono x={target.x} y={target.y + 46} anchor="middle" size={8.5} fill="rgba(120,88,30,0.6)">
        {"< 1 s"}
      </Mono>
    </svg>
  );
}

/* Step 4: one click for each owner. Provider approves, then client; both signatures meet in the BLOOM-XCH receipt
   and petals bloom. A single 6s loop keeps the beats in order. */
const PETAL = "M0 0 C-5 -3 -7 -11 0 -15 C7 -11 5 -3 0 0 Z";
const LOOP = 6;

function OwnerCard({ x, name, at, l }: { x: number; name: string; at: number; l: Labels }) {
  const k = (s: number) => (s / LOOP).toFixed(3);
  return (
    <g>
      <rect x={x} y={86} width={170} height={148} rx={14} fill={CARD} stroke="rgba(120,88,30,0.28)" />
      <Mono x={x + 16} y={110} size={8.5} fill="rgba(120,88,30,0.7)" spacing="0.14em">
        {name.toUpperCase()}
      </Mono>
      {["terms", "margin proof", "mandate"].map((row, i) => (
        <g key={row}>
          <Mono x={x + 16} y={134 + i * 17} size={9.5} fill="rgba(22,17,15,0.55)">
            {row}
          </Mono>
          <Mono x={x + 154} y={134 + i * 17} size={9.5} fill={GOLD} anchor="end">
            ✓
          </Mono>
        </g>
      ))}
      <rect x={x + 16} y={192} width={138} height={28} rx={14} fill="none" stroke={GOLD} strokeOpacity={0.6} />
      <Mono x={x + 85} y={210} anchor="middle" size={10} fill={GOLD}>
        {l.approve}
      </Mono>
      <g opacity={0}>
        <animate attributeName="opacity" values="0;0;1;1;0" keyTimes={`0;${k(at)};${k(at + 0.12)};0.92;1`} dur={`${LOOP}s`} repeatCount="indefinite" />
        <rect x={x + 16} y={192} width={138} height={28} rx={14} fill="#7a5c1e" />
        <Mono x={x + 85} y={210} anchor="middle" size={10} fill="#fdfbf5">
          {`✓ ${l.approved}`}
        </Mono>
      </g>
      {/* The click */}
      <circle cx={x + 85} cy={206} r={4} fill="none" stroke="#7a5c1e" opacity={0}>
        <animate attributeName="r" values="4;4;26" keyTimes={`0;${k(at)};${k(at + 0.6)}`} dur={`${LOOP}s`} repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;0;0.9;0;0" keyTimes={`0;${k(at)};${k(at + 0.05)};${k(at + 0.6)};1`} dur={`${LOOP}s`} repeatCount="indefinite" />
      </circle>
    </g>
  );
}

function SignoffScene({ l }: { l: Labels }) {
  const sealAt = 3;
  const k = (s: number) => (s / LOOP).toFixed(3);
  const petals = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const dist = 110 + (i % 3) * 24;
    return { dx: Math.cos(a) * dist * 0.8, dy: Math.sin(a) * dist * 0.6, rot: (i % 2 ? 1 : -1) * (120 + i * 17), color: i % 3 === 0 ? GOLD : i % 3 === 1 ? CRIMSON : "#9a0b25" };
  });
  return (
    <svg viewBox="0 0 800 320" className="block h-auto w-full" role="img" aria-label={l.receipt}>
      <Defs />
      <circle cx={400} cy={160} r={140} fill="url(#xch-gold-glow)" opacity={0.7} />
      {[
        { d: "M200 160 L290 160", at: 1.2 },
        { d: "M600 160 L510 160", at: 2.2 },
      ].map((p) => (
        <path key={p.d} d={p.d} stroke={GOLD} strokeWidth={1.4} pathLength={1} strokeDasharray="1" strokeDashoffset="1">
          <animate attributeName="stroke-dashoffset" values="1;1;0;0;1" keyTimes={`0;${k(p.at + 0.1)};${k(p.at + 0.6)};0.92;1`} dur={`${LOOP}s`} repeatCount="indefinite" />
        </path>
      ))}
      {petals.map((p, i) => (
        <path key={i} d={PETAL} fill={p.color} opacity={0}>
          <animateTransform attributeName="transform" type="translate" values={`400 160;400 160;${(400 + p.dx).toFixed(1)} ${(160 + p.dy).toFixed(1)}`} keyTimes={`0;${k(sealAt)};1`} calcMode="spline" keySplines="0 0 1 1;0.16 1 0.3 1" dur={`${LOOP}s`} repeatCount="indefinite" additive="replace" />
          <animateTransform attributeName="transform" type="rotate" values={`0;0;${p.rot}`} keyTimes={`0;${k(sealAt)};1`} dur={`${LOOP}s`} repeatCount="indefinite" additive="sum" />
          <animate attributeName="opacity" values="0;0;0.95;0" keyTimes={`0;${k(sealAt)};${k(sealAt + 0.3)};1`} dur={`${LOOP}s`} repeatCount="indefinite" />
        </path>
      ))}
      <OwnerCard x={30} name={l.provider} at={1.1} l={l} />
      <OwnerCard x={600} name={l.client} at={2.1} l={l} />

      <rect x={290} y={96} width={220} height={128} rx={14} fill={CARD} stroke={GOLD} strokeOpacity={0.35} />
      <rect x={290} y={96} width={220} height={128} rx={14} fill="none" stroke={GOLD} opacity={0}>
        <animate attributeName="opacity" values="0;0;0.85;0.85;0" keyTimes={`0;${k(sealAt)};${k(sealAt + 0.15)};0.92;1`} dur={`${LOOP}s`} repeatCount="indefinite" />
      </rect>
      <Mono x={400} y={122} anchor="middle" size={8.5} fill="rgba(120,88,30,0.7)" spacing="0.18em">
        BLOOM-XCH
      </Mono>
      <Mono x={400} y={146} anchor="middle" size={12.5} fill={GOLD}>
        7FJB-NE6B-Q2ZK
      </Mono>
      <line x1={310} x2={490} y1={158} y2={158} stroke={LINE} />
      {["Ed25519", "chain", "AP2"].map((key, i) => {
        const at = sealAt + i * 0.15;
        return (
          <g key={key}>
            <Mono x={318} y={178 + i * 15} size={9.5} fill="rgba(22,17,15,0.6)">
              {key}
            </Mono>
            <text x={482} y={178 + i * 15} textAnchor="end" fontSize={9.5} fill={GOLD} className="font-mono" opacity={0}>
              ✓
              <animate attributeName="opacity" values="0;0;1;1;0" keyTimes={`0;${k(at)};${k(at + 0.1)};0.92;1`} dur={`${LOOP}s`} repeatCount="indefinite" />
            </text>
          </g>
        );
      })}
      <g opacity={0}>
        <animate attributeName="opacity" values="0;0;1;1;0" keyTimes={`0;${k(sealAt + 0.4)};${k(sealAt + 0.6)};0.92;1`} dur={`${LOOP}s`} repeatCount="indefinite" />
        <Mono x={400} y={252} anchor="middle" size={9.5} fill={GOLD} spacing="0.12em">
          {l.receipt.toUpperCase()}
        </Mono>
      </g>
    </svg>
  );
}

export function BloomInfrastructureTheater({ initialStep = 0 }: { initialStep?: number }) {
  const t = useOmniCopy().theater;
  const [step, setStep] = useState(initialStep);
  const [playing, setPlaying] = useState(true);
  const [hover, setHover] = useState(false);
  const [still, setStill] = useState(false);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setStill(reduce);
    if (reduce) setPlaying(false);
  }, []);
  // Off-screen, the scene stops drawing (SMIL repaints on the main thread) and the step timer holds.
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "80px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const id = setTimeout(
      () =>
        stage.current?.querySelectorAll("svg").forEach((s) => {
          if (still) {
            s.setCurrentTime(1.6);
            s.pauseAnimations();
          } else if (visible) s.unpauseAnimations();
          else s.pauseAnimations();
        }),
      40,
    );
    return () => clearTimeout(id);
  }, [step, still, visible]);

  const n = t.scenes.length;
  const go = (i: number) => setStep((i + n) % n);
  const scene = t.scenes[step];
  const running = playing && !hover && visible;

  return (
    <section
      className="xch-card relative overflow-hidden outline-none focus-visible:ring-1 focus-visible:ring-[var(--xch-verified)]"
      tabIndex={0}
      aria-roledescription="carousel"
      aria-label={t.title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(step + 1);
        if (e.key === "ArrowLeft") go(step - 1);
        if (e.key === " ") {
          e.preventDefault();
          setPlaying((p) => !p);
        }
      }}
    >
      <div className="xch-velvet pointer-events-none absolute -left-24 -top-24 size-[420px] rounded-full bg-[radial-gradient(closest-side,rgba(225,29,72,0.12),transparent)]" aria-hidden />
      <div className="relative flex flex-wrap items-center gap-3 border-b border-[var(--xch-line)] px-4 py-3 sm:px-5">
        <p className="xch-display text-[21px] text-[var(--xch-ink)]">{t.title}</p>
        <Badge className="ms-auto">{t.illustrative}</Badge>
        <button type="button" onClick={() => setPlaying((p) => !p)} aria-label={playing ? t.pause : t.play} className="xch-btn p-1.5 text-x-ink/60 hover:text-x-ink">
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </button>
      </div>

      <div role="tablist" className="relative grid grid-cols-2 gap-px border-b border-[var(--xch-line)] bg-[var(--xch-line)] sm:grid-cols-4">
        {t.scenes.map((s, i) => (
          <button key={s.kicker} type="button" role="tab" aria-selected={step === i} onClick={() => (go(i), setPlaying(false))} className={cn("relative bg-[var(--xch-raise)] px-3 py-2.5 text-start transition-colors duration-150 sm:px-4", step === i ? "text-x-ink" : "text-x-ink/45 hover:text-x-ink/75")}>
            <span className={cn("block font-mono text-[9.5px] uppercase tracking-[0.16em]", "text-[var(--xch-verified)]", step !== i && "opacity-60")}>{s.kicker}</span>
            <span className="mt-0.5 block truncate text-[12.5px]">{s.title}</span>
            <span className="absolute inset-x-0 bottom-0 h-[2px] bg-x-ink/[0.04]">
              {step === i && <span key={step} className="xch-step-progress absolute inset-0 block origin-left bg-[var(--xch-verified)]" style={{ animationDuration: `${STEP_SECONDS}s`, animationPlayState: running ? "running" : "paused" }} onAnimationEnd={() => running && go(step + 1)} />}
              {step > i && <span className="absolute inset-0 block bg-[var(--xch-verified)]/40" />}
            </span>
          </button>
        ))}
      </div>

      <div className="relative grid grid-cols-1 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div ref={stage} className="min-w-0 border-[var(--xch-line)] p-3 sm:p-4 lg:border-e" dir="ltr">
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.01 }} transition={SPRING} className="overflow-hidden rounded-[12px] border border-[var(--xch-line-strong)] bg-x-ink/[0.025]">
              {step === 0 && <StackScene l={t.labels} />}
              {step === 1 && <LinkScene l={t.labels} />}
              {step === 2 && <MatchScene l={t.labels} />}
              {step === 3 && <SignoffScene l={t.labels} />}
            </motion.div>
          </AnimatePresence>
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={SPRING} className="min-w-0 p-4 sm:p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--xch-verified)]">{scene.kicker}</p>
            <h3 className="xch-display mt-2 text-[32px] leading-[1.05] text-[var(--xch-ink)]">{scene.title}</h3>
            <p className="mt-3 text-[13px] leading-relaxed text-x-ink/55">{scene.sub}</p>
            <ul className="mt-5 space-y-2.5">
              {scene.bullets.map((b, i) => (
                <li key={b} className="xch-row-in flex items-start gap-2.5 text-[12.5px] leading-snug text-x-ink/80" style={{ animationDelay: `${80 + i * 70}ms` }}>
                  <Check className="mt-[3px] size-3 shrink-0 text-[var(--xch-verified)]" />
                  {b}
                </li>
              ))}
            </ul>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
