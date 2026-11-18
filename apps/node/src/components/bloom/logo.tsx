"use client";

import { useId } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

// Ring sized to Outfit Medium's "o" so it sits beside the real one without a seam.
const RING_R = 12.6;
const RING_W = 5.2;
const PETAL_LEN = 7.4;

/**
 * The first "o" of Bloom: a softly shaded torus with a five-petal crimson bloom in its counter,
 * lit from the upper left like the rest of the page.
 */
function BloomO({ ink = false }: { ink?: boolean }) {
  const uid = useId().replace(/:/g, "");
  const arc = PETAL_LEN * 0.56;
  return (
    <svg viewBox="-16 -16 32 32" aria-hidden className="inline-block size-[0.545em] shrink-0 translate-y-[0.01em] overflow-visible">
      <defs>
        <linearGradient id={`${uid}-ring`} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor={ink ? "#4a3f43" : "#ffffff"} />
          <stop offset="0.55" stopColor={ink ? "#241c1e" : "#f3f0f8"} />
          <stop offset="1" stopColor={ink ? "#0f0a0b" : "#cdc6da"} />
        </linearGradient>
        <linearGradient id={`${uid}-petal`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#5c0414" />
          <stop offset="0.6" stopColor="#b8122e" />
          <stop offset="1" stopColor="#ff5c74" />
        </linearGradient>
      </defs>

      {/* Torus body and specular glint */}
      <circle r={RING_R} fill="none" stroke={`url(#${uid}-ring)`} strokeWidth={RING_W} />
      <path
        d={`M${-RING_R * 0.92} ${-RING_R * 0.38} A${RING_R} ${RING_R} 0 0 1 ${-RING_R * 0.38} ${-RING_R * 0.92}`}
        fill="none"
        stroke={ink ? "rgba(255,255,255,0.45)" : "#fff"}
        strokeWidth={1.3}
        strokeLinecap="round"
      />

      {/* Five lens petals, shaded dark at the heart and lit at the tips */}
      <g className="origin-center transition-transform duration-700 ease-out [transform-box:fill-box] group-hover:rotate-[72deg]">
        {[0, 72, 144, 216, 288].map((a) => (
          <path
            key={a}
            d={`M0 0 A${arc} ${arc} 0 0 1 0 ${-PETAL_LEN} A${arc} ${arc} 0 0 1 0 0 Z`}
            transform={`rotate(${a})`}
            fill={`url(#${uid}-petal)`}
          />
        ))}
      </g>
      <circle r={1.3} fill="#2a0108" />
    </svg>
  );
}

/**
 * Inline so no stylesheet or inherited `dir` can win: the pieces of the wordmark always run left to right,
 * in the order they're written.
 */
const LTR_LOCK: React.CSSProperties = { direction: "ltr", unicodeBidi: "bidi-override", flexDirection: "row" };

/**
 * "Bloom AI" in Outfit Medium with the bloom woven into the first o.
 * Always laid out left to right and isolated from the surrounding text direction: in an RTL page the flex
 * row of letter groups would otherwise reverse into "AI omoBl".
 */
export function BloomWordmark({ className, tone = "light" }: { className?: string; tone?: "light" | "ink" }) {
  const ink = tone === "ink";
  return (
    <span dir="ltr" style={LTR_LOCK} className={cn("inline-flex items-baseline font-logo font-medium tracking-[-0.03em]", ink ? "text-[#16110f]" : "text-white", className)}>
      <span className="sr-only">Bloom AI</span>
      <span aria-hidden dir="ltr" style={LTR_LOCK} className="inline-flex items-baseline">
        Bl
        <span className="mx-[0.012em] inline-flex">
          <BloomO ink={ink} />
        </span>
        om
        <span className={cn("ms-[0.24em] font-normal tracking-[0.01em]", ink ? "text-[#16110f]/55" : "text-white/60")}>AI</span>
      </span>
    </span>
  );
}

export function BloomLogo({ className }: { className?: string }) {
  return (
    <Link href="/" dir="ltr" style={LTR_LOCK} aria-label="Bloom AI home" className={cn("group relative inline-flex items-center", className)}>
      <BloomWordmark className="text-[22px]" />
    </Link>
  );
}
