"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { ARCH, BotanicalSprig } from "@/components/art/Botanical";
import { BloomWordmark } from "@/components/bloom/logo";
import { useDeskCopy } from "./desk-copy";

export const INTRO_KEY = "bloom-exchange-intro";

/**
 * The garden, engraved in gold leaf on a museum wall. Alabaster light; a classical arch drawing itself in around
 * a faint oil painting of a garden; two botanical sprigs climbing from the lower corners in 1px gold strokes,
 * stems first, then leaves, tendrils and roses; a few points of warm luminescence; then the Bloom wordmark and
 * "Intent, not noise." At ~4.2s the whole engraving fades into the gallery underneath. Esc, Enter, a click or
 * Skip go straight there. Once per session; reduced motion skips it (see exchange-app).
 */
const DAWN_AT = 4200;
const DAWN_MS = 800;
const EASE = [0.16, 1, 0.3, 1] as const;

/** Warm luminescence on white: a handful of soft gold motes rising slowly. One pre-rendered glow, capped DPR. */
function Luminescence() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    let w = 0;
    let h = 0;
    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const n = w < 640 ? 12 : 22;
    const motes = Array.from({ length: n }, (_, i) => ({ x: Math.random() * w, y: h * (0.35 + Math.random() * 0.65), vx: (Math.random() - 0.5) * 0.1, vy: -0.05 - Math.random() * 0.1, r: 0.9 + Math.random() * 1.2, ph: (i / n) * Math.PI * 2, sp: 0.35 + Math.random() * 0.6 }));
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = 64;
    const s = sprite.getContext("2d")!;
    const g = s.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(196, 150, 62, 0.75)");
    g.addColorStop(0.3, "rgba(214, 176, 100, 0.28)");
    g.addColorStop(1, "rgba(214, 176, 100, 0)");
    s.fillStyle = g;
    s.fillRect(0, 0, 64, 64);
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      const fade = Math.min(1, t / 1.8);
      ctx.clearRect(0, 0, w, h);
      for (const m of motes) {
        m.x += m.vx + Math.sin(t * 0.4 + m.ph) * 0.07;
        m.y += m.vy;
        if (m.y < -10) {
          m.y = h + 10;
          m.x = Math.random() * w;
        }
        ctx.globalAlpha = fade * (0.12 + 0.45 * (0.5 + 0.5 * Math.sin(t * m.sp + m.ph)));
        const size = m.r * 12;
        ctx.drawImage(sprite, m.x - size / 2, m.y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />;
}

export function GardenIntro({ onDone, onDawn }: { onDone: () => void; onDawn?: () => void }) {
  const t = useDeskCopy().intro;
  const [dawn, setDawn] = useState(false);
  const done = useRef(false);

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    try {
      sessionStorage.setItem(INTRO_KEY, "1");
    } catch {
      // Plays again next load.
    }
    onDone();
  }, [onDone]);

  const toDawn = useCallback(() => setDawn(true), []);
  useEffect(() => {
    const timer = setTimeout(toDawn, DAWN_AT);
    const onKey = (e: KeyboardEvent) => (e.key === "Escape" || e.key === "Enter") && toDawn();
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [toDawn]);
  useEffect(() => {
    if (!dawn) return;
    onDawn?.();
    const id = setTimeout(finish, DAWN_MS);
    return () => clearTimeout(id);
  }, [dawn, finish, onDawn]);

  return (
    <motion.div
      className="xch-intro visible fixed inset-0 z-[130] cursor-pointer overflow-hidden bg-[#faf9f6]"
      onClick={toDawn}
      role="presentation"
      dir="ltr"
      initial={false}
      animate={dawn ? { opacity: 0, scale: 1.015 } : { opacity: 1, scale: 1 }}
      transition={{ duration: DAWN_MS / 1000, ease: [0.65, 0, 0.35, 1] }}
    >
      {/* Gallery light */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_55%_at_50%_38%,#ffffff,rgba(250,249,246,0)_70%),radial-gradient(80%_60%_at_50%_110%,rgba(196,160,92,0.10),transparent_70%)]" aria-hidden />

      {/* The arch, with a garden painting held faintly inside it. The painting is an HTML layer whose fade runs on
          the compositor; the SVG carries only the two hairlines drawing in. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
        <div className="relative aspect-[444/624] h-[min(78vh,700px)]">
          <motion.div className="absolute inset-x-[5.4%] bottom-[1.9%] top-[3.85%] overflow-hidden rounded-[50%_50%_0_0/33.7%_33.7%_0_0] will-change-[opacity]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 2.4, delay: 0.5, ease: EASE }}>
            <Image src="/paintings/villa-deste.jpg" alt="" fill priority sizes="420px" quality={75} className="object-cover opacity-[0.62] saturate-[0.85] sepia-[0.15]" />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(250,249,246,0.22),rgba(250,249,246,0.5)_50%,rgba(250,249,246,0.96))]" />
          </motion.div>
          <svg viewBox="-12 -12 444 624" className="absolute inset-0 h-full w-full">
            <path d={ARCH.outer} pathLength={1} className="xch-draw" fill="none" stroke="var(--xch-leaf, #a8843f)" strokeWidth={1.1} style={{ animationDuration: "2.4s" }} />
            <path d={ARCH.inner} pathLength={1} className="xch-draw" fill="none" stroke="var(--xch-leaf, #a8843f)" strokeOpacity={0.5} strokeWidth={1} style={{ animationDelay: "0.25s", animationDuration: "2.4s" }} />
          </svg>
        </div>
      </div>
      {/* Botanical engraving rising from the lower corners */}
      <BotanicalSprig draw delay={0.2} className="pointer-events-none absolute bottom-0 left-0 h-[72vh] w-[min(40vw,calc(72vh*0.684))]" />
      <BotanicalSprig draw delay={0.45} mirror className="pointer-events-none absolute bottom-0 right-0 h-[72vh] w-[min(40vw,calc(72vh*0.684))]" />

      <Luminescence />

      <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
        <motion.div className="text-6xl sm:text-8xl" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.6, delay: 0.9, ease: EASE }}>
          <BloomWordmark tone="ink" />
        </motion.div>
        <motion.p className="xch-display mt-1 text-[44px] font-normal italic leading-none text-x-ink/65 sm:text-[60px]" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.3, delay: 1.3, ease: EASE }}>
          Exchange
        </motion.p>
        <motion.span className="mt-7 block h-px w-36 origin-center bg-[linear-gradient(90deg,transparent,var(--xch-leaf,#a8843f),transparent)]" initial={{ scaleX: 0, opacity: 0 }} animate={{ scaleX: 1, opacity: 1 }} transition={{ duration: 1.4, delay: 1.7, ease: EASE }} aria-hidden />
        <motion.p className="xch-display mt-6 text-[28px] text-x-ink sm:text-[38px]" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.3, delay: 2.0, ease: EASE }}>
          {t.line}
        </motion.p>
        <motion.p className="mt-3 font-mono text-[10px] uppercase tracking-[0.32em] text-x-ink/45" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.2, delay: 2.5 }}>
          {t.sub}
        </motion.p>
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toDawn();
        }}
        className="xch-btn absolute bottom-5 end-5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-x-ink/60"
      >
        {t.skip} · Esc
      </button>
    </motion.div>
  );
}
