type Tone = "pass" | "fail" | "sealed" | "idle";

const STYLE: Record<Tone, { color: string; bg: string; mark: string }> = {
  pass: { color: "var(--pass)", bg: "var(--pass-bg)", mark: "PASS" },
  fail: { color: "var(--fail)", bg: "var(--fail-bg)", mark: "FAIL" },
  sealed: { color: "var(--sealed)", bg: "var(--sealed-bg)", mark: "SEALED" },
  idle: { color: "var(--idle)", bg: "var(--idle-bg)", mark: "N/A" },
};

/** A check result, readable without color: the word carries the verdict, the color only repeats it. */
export function Badge({ label, tone, detail }: { label: string; tone: Tone; detail: string }) {
  const s = STYLE[tone];
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-line bg-surface p-4">
      <div className="min-w-0">
        <div className="font-medium">{label}</div>
        <div className="mt-1 text-sm text-muted">{detail}</div>
      </div>
      <span className="shrink-0 rounded-md px-2.5 py-1 font-mono text-xs font-semibold tracking-wide" style={{ color: s.color, background: s.bg }}>
        {s.mark}
      </span>
    </div>
  );
}

export const toneOf = (v: "pass" | "fail" | "sealed" | "unavailable"): Tone => (v === "unavailable" ? "idle" : v);
