/** Small numeric helpers the engine tools share. All deterministic: same input, same output. */

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
export const round = (n: number, step = 1) => Math.round(n / step) * step;
export const pct = (n: number) => Math.round(n * 1000) / 10;

/** A seeded PRNG (FNV-1a hash into mulberry32), so simulated feeds are stable for a given input. */
export function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T,>(list: readonly T[]) => list[Math.floor(next() * list.length)],
  };
}

/** Pulls the first dollar figure out of a command ("$40k", "$1.2m", "40000 usd"), if any. */
export function dollarsIn(text: string): number | undefined {
  const m = text.match(/\$\s?(\d+(?:[.,]\d+)?)\s*(k|m|mm)?\b|(\d+(?:[.,]\d+)?)\s*(k|m)?\s*(?:usd|dollars)\b/i);
  if (!m) return undefined;
  const n = parseFloat((m[1] ?? m[3]).replace(",", ""));
  const unit = (m[2] ?? m[4] ?? "").toLowerCase();
  return n * (unit === "k" ? 1e3 : unit === "m" || unit === "mm" ? 1e6 : 1);
}
