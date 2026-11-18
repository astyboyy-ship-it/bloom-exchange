"use client";

import { useRef, useState } from "react";
import { ArrowRight, Fingerprint, Link2, Lock, PlayCircle, Workflow, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { BloomInfrastructureTheater } from "./BloomInfrastructureTheater";
import { useDeskCopy, type GuideModuleId } from "./desk-copy";
import { Badge } from "./ui";

/** Which theater step illustrates each module. */
const SCENE: Record<GuideModuleId, number> = { stack: 0, link: 1, sandbox: 2, settle: 3 };
const ICON: Record<GuideModuleId, LucideIcon> = { link: Link2, sandbox: Lock, stack: Workflow, settle: Fingerprint };

/**
 * The showcase: the animated walkthrough of how Bloom ends agent chaos, then one operational card per module
 * (Universal Bloom Links, the double-blind sandbox, agent stack orchestration, one-click Ed25519 settlement): a
 * plain summary, the mechanics in three lines, whether it ships today, and a button that does the thing on this
 * desk. Bloom Links are marked as a concept; the rest run here.
 */
export function GuideAndShowcaseHub({ onAction }: { onAction: (id: GuideModuleId) => void }) {
  const t = useDeskCopy().guide;
  const [scene, setScene] = useState(0);
  const [play, setPlay] = useState(0);
  const stage = useRef<HTMLDivElement>(null);

  const watch = (id: GuideModuleId) => {
    setScene(SCENE[id]);
    setPlay((n) => n + 1);
    stage.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-5">
      <section className="px-1 pt-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-x-ink/45">{t.kicker}</p>
        <h1 className="xch-display mt-3 text-[34px] leading-[1.05] text-x-ink sm:text-[48px]">
          {t.title} <span className="xch-gold-italic">{t.accent}</span>
        </h1>
        <p className="mt-3 max-w-2xl text-[13.5px] leading-relaxed text-x-ink/55">{t.sub}</p>
      </section>

      <div ref={stage} className="scroll-mt-28">
        <BloomInfrastructureTheater key={play} initialStep={scene} />
      </div>
      <p className="px-1 text-[11.5px] text-x-ink/40">{t.note}</p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {t.modules.map((m, i) => {
          const Icon = ICON[m.id];
          const live = m.status === "live";
          return (
            <article key={m.id} className="xch-card flex min-w-0 flex-col p-5">
              <header className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full border border-[var(--xch-line-strong)] bg-[var(--xch-card-solid)]">
                  <Icon className="size-[18px] text-x-ink/45" strokeWidth={1.4} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-x-ink/40">
                    {t.chapter} {String(i + 1).padStart(2, "0")}
                  </p>
                  <h2 className="xch-display mt-0.5 text-[22px] leading-tight text-x-ink">{m.title}</h2>
                </div>
                <Badge tone={live ? "emerald" : "muted"}>{t.status[m.status]}</Badge>
              </header>
              <p className="mt-3 text-[13px] leading-relaxed text-x-ink/65">{m.summary}</p>
              <p className="mt-4 font-mono text-[9.5px] uppercase tracking-[0.18em] text-x-ink/40">{t.how}</p>
              <ol className="mt-2 space-y-1.5">
                {m.steps.map((s, k) => (
                  <li key={s} className="grid grid-cols-[20px_1fr] gap-2 text-[12.5px] leading-snug text-x-ink/80">
                    <span className="tnum font-mono text-[10.5px] text-x-ink/45">{k + 1}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-auto flex flex-wrap gap-2 pt-5">
                <button type="button" onClick={() => watch(m.id)} className="xch-btn flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] text-x-ink/75 hover:text-x-ink">
                  <PlayCircle className="size-3.5" strokeWidth={1.5} /> {t.watch}
                </button>
                {live && (
                  <button type="button" onClick={() => onAction(m.id)} className={cn("xch-btn-ink flex items-center gap-1.5 px-3.5 py-1.5 text-[12px]")}>
                    {m.cta} <ArrowRight className="size-3.5" strokeWidth={1.6} />
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
