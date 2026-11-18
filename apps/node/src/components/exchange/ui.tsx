"use client";

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export const PARLIAMENT_NODES = [
  { engine: "shield", label: "Shield" },
  { engine: "cortex", label: "Cortex" },
  { engine: "aether", label: "Aether" },
  { engine: "sovereign", label: "Sovereign" },
  { engine: "apex", label: "Apex" },
] as const;

/** Engine names stay neutral ink; colour belongs to the line's meaning (verified, clamped, threat), never to the engine. */
export const ENGINE_TONE: Record<string, string> = {
  shield: "text-x-ink/70",
  cortex: "text-x-ink/70",
  aether: "text-x-ink/70",
  sovereign: "text-x-ink/70",
  apex: "text-x-ink/70",
};

/** 150ms tension-damped spring for palettes, drawers and split panes. */
export const SPRING = { type: "spring", visualDuration: 0.15, bounce: 0.12 } as const;

export const usd = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`);
export const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
export const short = (h: string, n = 10) => `${h.slice(0, n)}…`;

export function Panel({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={cn("xch-card min-w-0 p-4 sm:p-5", className)}>{children}</section>;
}

export function PanelHeader({ icon: Icon, title, sub, right }: { icon: LucideIcon; title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="xch-display flex items-center gap-2 text-[19px] leading-tight text-[var(--xch-ink)]">
          <Icon className="size-[15px] shrink-0 text-x-ink/45" strokeWidth={1.75} /> {title}
        </h2>
        {sub && <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-x-ink/45">{sub}</p>}
      </div>
      {right}
    </header>
  );
}

export type Tone = "emerald" | "amber" | "rose" | "muted" | "solid";
const TONES: Record<Tone, string> = {
  emerald: "border-[color-mix(in_srgb,var(--xch-verified)_40%,transparent)] bg-[color-mix(in_srgb,var(--xch-verified)_7%,transparent)] text-[var(--xch-verified)]",
  amber: "border-[color-mix(in_srgb,var(--xch-clamp)_40%,transparent)] bg-[color-mix(in_srgb,var(--xch-clamp)_7%,transparent)] text-[var(--xch-clamp)]",
  rose: "border-[color-mix(in_srgb,var(--xch-threat)_40%,transparent)] bg-[color-mix(in_srgb,var(--xch-threat)_7%,transparent)] text-[var(--xch-threat)]",
  muted: "border-[var(--xch-line)] text-x-ink/55",
  solid: "border-[var(--xch-line-strong)] bg-x-ink/[0.04] text-x-ink/80",
};

export function Badge({ tone = "muted", className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-[4px] border px-1.5 py-[3px] font-mono text-[9px] uppercase leading-none tracking-[0.14em]", TONES[tone], className)}>{children}</span>;
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-[var(--xch-line-strong)] bg-[var(--xch-card-solid)] px-1 font-mono text-[10px] text-x-ink/55 shadow-[inset_0_-1px_0_rgba(120,88,30,0.12)]", className)}>{children}</kbd>;
}

export function Stat({ label, value, tone, sub }: { label: string; value: React.ReactNode; tone?: string; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-[10px] border border-[var(--xch-line)] bg-x-ink/[0.025] px-3 py-2.5">
      <p className="truncate font-mono text-[9.5px] uppercase tracking-[0.16em] text-x-ink/40">{label}</p>
      <p className={cn("tnum mt-1 truncate font-mono text-[17px] tracking-[-0.01em] text-x-ink", tone)}>{value}</p>
      {sub && <p className="tnum mt-0.5 truncate font-mono text-[10px] text-x-ink/35">{sub}</p>}
    </div>
  );
}

const GLYPHS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Character-by-character decode: every position cycles through Crockford glyphs and locks left to right.
 * Separators (dashes) lock immediately, so the id's shape is legible from the first frame.
 */
export function HashDecode({ text, className, ms = 720 }: { text: string; className?: string; ms?: number }) {
  const [shown, setShown] = useState(text);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(text);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const locked = Math.floor(p * text.length);
      setShown(
        Array.from(text, (ch, i) => (i < locked || ch === "-" || ch === " " ? ch : GLYPHS[(Math.floor(now / 28) + i * 7) % GLYPHS.length])).join(""),
      );
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, ms]);
  return (
    <span className={cn("tnum font-mono", className)} dir="ltr" aria-label={text}>
      {shown}
    </span>
  );
}
