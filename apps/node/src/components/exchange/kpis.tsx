"use client";

import { useExchangeCopy } from "./copy";
import { Stat, usd } from "./ui";
import type { Row } from "./use-exchange";

export function Kpis({ rows }: { rows: Row[] }) {
  const t = useExchangeCopy().kpi;
  const settled = rows.filter((r) => r.state === "completed");
  const volume = settled.reduce((s, r) => s + (r.priceUsd ?? 0), 0);
  const threats = rows.reduce((s, r) => s + r.threats, 0);
  const avgRounds = rows.length ? rows.reduce((s, r) => s + r.rounds, 0) / rows.length : 0;
  const open = rows.filter((r) => r.state === "input_required").length;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      <Stat label={t.settled} value={settled.length} tone={settled.length ? "text-[var(--xch-verified)]" : undefined} sub={t.session} />
      <Stat label={t.volume} value={usd(volume)} sub="USD" />
      <Stat label={t.threats} value={threats} tone={threats ? "text-[var(--xch-threat)]" : undefined} sub="Shield" />
      <Stat label={t.rounds} value={avgRounds ? avgRounds.toFixed(1) : "—"} sub="A2A" />
      <Stat label={t.exceptions} value={open} tone={open ? "text-[var(--xch-clamp)]" : undefined} sub="Sovereign" />
    </div>
  );
}
