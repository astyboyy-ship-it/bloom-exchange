/**
 * A gold-leaf botanical engraving: one rising sprig (stems, almond leaves with midribs, curled tendrils, a
 * spiral rose and a bud), drawn entirely in 1px strokes with no fills, so it reads as line work on a museum
 * wall rather than an illustration. With `draw`, every stroke draws itself in on the compositor-friendly
 * stroke-dashoffset path, stems first, then leaves and flowers along their length; reduced motion shows it
 * complete. Static by default for ambient ornament.
 */

// Sprig in a 520 × 760 box, rooted at the bottom-left corner and rising to the upper right.
const STEMS = [
  { d: "M20 760 C 60 690 40 620 96 560 C 150 502 210 500 238 430 C 262 370 228 320 262 262 C 292 210 352 196 380 150", delay: 0 },
  { d: "M96 560 C 150 560 200 600 252 590 C 296 581 318 548 330 520", delay: 0.55 },
  { d: "M238 430 C 300 420 352 380 372 330", delay: 0.85 },
];
const TENDRILS = [
  { d: "M238 430 C 262 442 286 430 284 410 C 282 394 262 396 266 410", delay: 1.15 },
  { d: "M262 262 C 236 252 220 230 232 214 C 242 202 260 210 251 222", delay: 1.4 },
  { d: "M372 330 C 392 326 404 340 396 352 C 390 360 380 354 386 347", delay: 1.55 },
];
const LEAVES: { x: number; y: number; r: number; s: number; delay: number }[] = [
  { x: 46, y: 708, r: -118, s: 0.95, delay: 0.25 },
  { x: 58, y: 642, r: -22, s: 1.05, delay: 0.4 },
  { x: 112, y: 548, r: -152, s: 0.9, delay: 0.6 },
  { x: 168, y: 512, r: -36, s: 1.1, delay: 0.75 },
  { x: 214, y: 470, r: -148, s: 0.85, delay: 0.9 },
  { x: 180, y: 580, r: 40, s: 0.8, delay: 0.95 },
  { x: 246, y: 360, r: -12, s: 0.95, delay: 1.05 },
  { x: 250, y: 310, r: -160, s: 0.85, delay: 1.2 },
  { x: 300, y: 214, r: -40, s: 0.9, delay: 1.35 },
  { x: 318, y: 394, r: -68, s: 0.8, delay: 1.25 },
];
const LEAF = "M0 0 C 9 -10 26 -12 40 0 C 26 10 9 10 0 0 Z";
const MIDRIB = "M3 0 C 14 -1 26 -1 37 0";
const ROSE = [
  "M0 0 C 4 -4 10 -1 8 4 C 6 9 -2 10 -6 5 C -11 -1 -7 -11 2 -12 C 12 -13 18 -4 15 6 C 12 16 -2 20 -12 14 C -22 8 -22 -8 -12 -16 C -2 -24 16 -22 23 -10",
  "M-12 14 C -24 26 -6 37 9 31 C 21 26 27 14 24 4",
  "M23 -10 C 33 -2 33 14 22 23",
  "M-12 -16 C -26 -10 -30 6 -22 16",
];
const BUD = "M0 0 C -6 -6 -3 -15 4 -15 C 11 -13 10 -4 4 0 M0 0 C 2 4 2 8 0 12";

type Props = { className?: string; draw?: boolean; delay?: number; mirror?: boolean; tone?: string; opacity?: number };

const LINE = (tone: string) => ({ fill: "none", stroke: tone, strokeWidth: 1.1, strokeLinecap: "round" as const, strokeLinejoin: "round" as const });

function Foliage({ tone, leaves, rose, bud }: { tone: string; leaves: typeof LEAVES; rose?: boolean; bud?: boolean }) {
  const line = LINE(tone);
  return (
    <>
      {leaves.map((l) => (
        <g key={`${l.x}-${l.y}`} transform={`translate(${l.x} ${l.y}) rotate(${l.r}) scale(${l.s})`}>
          <path d={LEAF} {...line} />
          <path d={MIDRIB} {...line} strokeOpacity={0.7} />
        </g>
      ))}
      {rose && (
        <g transform="translate(380 150) rotate(-18)">
          {ROSE.map((d) => (
            <path key={d} d={d} {...line} />
          ))}
        </g>
      )}
      {bud && (
        <g transform="translate(330 520) rotate(28)">
          <path d={BUD} {...line} />
        </g>
      )}
    </>
  );
}

/**
 * Static: one SVG. Drawn: the stems and tendrils draw themselves in (a handful of strokes, cheap to repaint),
 * while the foliage arrives as two separate layers that bloom in with opacity and scale on the compositor,
 * lower leaves first, then the upper leaves, the rose and the bud. Same engraving either way.
 */
export function BotanicalSprig({ className, draw = false, delay = 0, mirror = false, tone = "var(--xch-leaf, #a8843f)", opacity = 1 }: Props) {
  const flip = mirror ? "matrix(-1 0 0 1 520 0)" : undefined;
  const align = mirror ? "xMaxYMax meet" : "xMinYMax meet";
  const line = LINE(tone);
  if (!draw)
    return (
      <svg viewBox="0 0 520 760" preserveAspectRatio={align} className={className} style={{ opacity }} aria-hidden>
        <g transform={flip}>
          {[...STEMS, ...TENDRILS].map((s) => (
            <path key={s.d} d={s.d} {...line} />
          ))}
          <Foliage tone={tone} leaves={LEAVES} rose bud />
        </g>
      </svg>
    );

  const lower = LEAVES.filter((l) => l.delay < 0.9);
  const upper = LEAVES.filter((l) => l.delay >= 0.9);
  const layer = "absolute inset-0 h-full w-full";
  const bloom = (d: number): React.CSSProperties => ({ animationDelay: `${delay + d}s`, transformOrigin: mirror ? "100% 100%" : "0% 100%" });
  return (
    <div className={className} style={{ opacity }} aria-hidden>
      <svg viewBox="0 0 520 760" preserveAspectRatio={align} className={layer}>
        <g transform={flip}>
          {STEMS.map((s) => (
            <path key={s.d} d={s.d} pathLength={1} {...line} className="xch-draw" style={{ animationDelay: `${delay + s.delay}s`, animationDuration: "2.2s" }} />
          ))}
          {TENDRILS.map((s) => (
            <path key={s.d} d={s.d} pathLength={1} {...line} className="xch-draw" style={{ animationDelay: `${delay + s.delay}s`, animationDuration: "1.1s" }} />
          ))}
        </g>
      </svg>
      <svg viewBox="0 0 520 760" preserveAspectRatio={align} className={`${layer} xch-bloom-in`} style={bloom(0.7)}>
        <g transform={flip}>
          <Foliage tone={tone} leaves={lower} />
        </g>
      </svg>
      <svg viewBox="0 0 520 760" preserveAspectRatio={align} className={`${layer} xch-bloom-in`} style={bloom(1.35)}>
        <g transform={flip}>
          <Foliage tone={tone} leaves={upper} rose bud />
        </g>
      </svg>
    </div>
  );
}
/** A classical arch, 420 × 600 with a semicircular head: two gold-leaf hairlines 12 apart. */
export const ARCH = { outer: "M0 600 L0 210 A210 210 0 0 1 420 210 L420 600", inner: "M12 600 L12 210 A198 198 0 0 1 408 210 L408 600" };
