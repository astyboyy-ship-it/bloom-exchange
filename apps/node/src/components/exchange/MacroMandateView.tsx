"use client";

import { useEffect, useState } from "react";
import { Grid3x3, Lock, RotateCcw, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { effectiveFloor, InitiatorMandateSchema, RESOURCE_DIMENSIONS, RESOURCE_UNITS, SLA_TIERS, type InitiatorMandate, type ResourceDimension } from "@bloom-exchange/core/types";
import { useExchangeCopy } from "./copy";
import { useDeskCopy } from "./desk-copy";
import { Badge, num, Panel, PanelHeader, usd } from "./ui";
import type { Exchange } from "./use-exchange";

const NUMERIC = ["anchorPriceUsd", "floorPriceUsd", "costBasisUsd", "minMarginPct", "maxNetDays", "autoSettleCeilingUsd"] as const;
const DEFAULT_OFFER: Record<ResourceDimension, { capacity: number; floorUnitPriceUsd: number }> = {
  computeUnits: { capacity: 100_000, floorUnitPriceUsd: 0.18 },
  energyKwh: { capacity: 40_000, floorUnitPriceUsd: 0.07 },
  capitalUsd: { capacity: 250_000, floorUnitPriceUsd: 0.02 },
  complianceToken: { capacity: 12, floorUnitPriceUsd: 250 },
  bandwidthGbps: { capacity: 40, floorUnitPriceUsd: 95 },
};

const input = "tnum w-full rounded-md border border-[var(--xch-line)] bg-x-ink/[0.025] px-2.5 py-1.5 font-mono text-[12.5px] text-x-ink outline-none transition-colors duration-150 focus:border-[color-mix(in_srgb,var(--xch-verified)_55%,transparent)]";
const label = "block truncate font-mono text-[9.5px] uppercase tracking-[0.14em] text-x-ink/40";

export function MacroMandateView({ x }: { x: Exchange }) {
  const t = useExchangeCopy();
  const [draft, setDraft] = useState<InitiatorMandate>(x.mandate);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(x.mandate), [x.mandate]);

  const valid = InitiatorMandateSchema.safeParse(draft).success;
  const dirty = JSON.stringify(draft) !== JSON.stringify(x.mandate);
  const floor = effectiveFloor(draft);
  const resources = draft.resources ?? {};
  const setRes = (d: ResourceDimension, patch: Partial<{ capacity: number; floorUnitPriceUsd: number }> | null) =>
    setDraft((m) => {
      const next = { ...(m.resources ?? {}) };
      if (patch === null) delete next[d];
      else next[d] = { ...(next[d] ?? DEFAULT_OFFER[d]), ...patch };
      return { ...m, resources: Object.keys(next).length ? next : undefined };
    });

  const save = async () => {
    setSaving(true);
    const ok = await x.saveMandate(draft);
    setSaving(false);
    if (ok) toast.success(t.mandate.saved);
    else toast.error(t.mandate.invalid);
  };

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      <div className="space-y-4 xl:col-span-7">
        <PriceCorridor draft={draft} setDraft={setDraft} onReset={() => setDraft(x.mandate)} dirty={dirty} />
        <Panel>
          <PanelHeader icon={Lock} title={t.mandate.title} sub={x.status?.operator ? t.mandate.subOperator : t.mandate.subSandbox} />
          <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {NUMERIC.map((k) => (
              <label key={k} className="block min-w-0">
                <span className={label}>{t.mandate.fields[k]}</span>
                <input type="number" inputMode="decimal" min={0} step={k === "minMarginPct" ? 0.5 : 1} value={draft[k]} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value === "" ? 0 : Number(e.target.value) }))} className={cn(input, "mt-1")} dir="ltr" />
              </label>
            ))}
            <label className="block min-w-0">
              <span className={label}>{t.mandate.fields.maxSlaTier}</span>
              <select value={draft.maxSlaTier} onChange={(e) => setDraft((d) => ({ ...d, maxSlaTier: e.target.value as InitiatorMandate["maxSlaTier"] }))} className={cn(input, "mt-1 capitalize")}>
                {SLA_TIERS.map((s) => (
                  <option key={s} value={s} className="bg-[var(--xch-card-solid)]">
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex min-w-0 flex-col justify-end">
              <span className={label}>{t.mandate.effectiveFloor}</span>
              <span className={cn("tnum mt-1 rounded-md border border-dashed px-2.5 py-1.5 font-mono text-[12.5px]", valid ? "border-[color-mix(in_srgb,var(--xch-verified)_35%,transparent)] text-[var(--xch-verified)]" : "border-[color-mix(in_srgb,var(--xch-clamp)_45%,transparent)] text-[var(--xch-clamp)]")} dir="ltr">
                {Number.isFinite(floor) ? usd(floor) : "—"}
              </span>
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHeader icon={Grid3x3} title={t.matrix.title} sub={t.matrix.sub} />
          <div className="mt-4 xch-scroll overflow-x-auto">
            <table className="tnum w-full min-w-[560px] text-[12px]">
              <thead>
                <tr className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-x-ink/35">
                  <th className="pb-2 text-start font-normal">{t.matrix.dimension}</th>
                  <th className="pb-2 text-start font-normal">{t.matrix.offered}</th>
                  <th className="pb-2 pe-2 text-start font-normal">{t.matrix.capacity}</th>
                  <th className="pb-2 pe-2 text-start font-normal">{t.matrix.unitFloor}</th>
                  <th className="pb-2 text-end font-normal">{t.matrix.maxFloor}</th>
                </tr>
              </thead>
              <tbody>
                {RESOURCE_DIMENSIONS.map((d) => {
                  const r = resources[d];
                  return (
                    <tr key={d} className="border-t border-[var(--xch-line)]">
                      <td className="py-2 pe-3">
                        <span className="text-x-ink/85">{t.matrix.dims[d]}</span>
                        <span className="ms-1.5 font-mono text-[10px] text-x-ink/35" dir="ltr">
                          {d} · {RESOURCE_UNITS[d]}
                        </span>
                      </td>
                      <td className="py-2 pe-3">
                        <button type="button" role="switch" aria-checked={Boolean(r)} aria-label={t.matrix.dims[d]} onClick={() => setRes(d, r ? null : {})} className={cn("relative h-4 w-7 rounded-full border transition-colors duration-150", r ? "border-[color-mix(in_srgb,var(--xch-verified)_50%,transparent)] bg-[color-mix(in_srgb,var(--xch-verified)_25%,transparent)]" : "border-[var(--xch-line-strong)] bg-x-ink/[0.03]")}>
                          <span className={cn("absolute top-[1px] size-3 rounded-full bg-x-ink transition-[inset-inline-start] duration-150", r ? "start-[13px]" : "start-[1px]")} />
                        </button>
                      </td>
                      <td className="py-2 pe-2">
                        <input type="number" min={0} disabled={!r} value={r?.capacity ?? ""} placeholder="—" onChange={(e) => setRes(d, { capacity: Number(e.target.value) })} className={cn(input, "w-28 disabled:opacity-30")} dir="ltr" />
                      </td>
                      <td className="py-2 pe-2">
                        <input type="number" min={0} step={0.01} disabled={!r} value={r?.floorUnitPriceUsd ?? ""} placeholder="—" onChange={(e) => setRes(d, { floorUnitPriceUsd: Number(e.target.value) })} className={cn(input, "w-24 disabled:opacity-30")} dir="ltr" />
                      </td>
                      <td className="py-2 text-end font-mono text-x-ink/70" dir="ltr">
                        {r ? usd(r.capacity * r.floorUnitPriceUsd) : <span className="text-x-ink/25">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!valid && <p className="mt-3 text-[11.5px] text-[var(--xch-clamp)]">{t.mandate.invalid}</p>}
          <button type="button" onClick={() => void save()} disabled={!valid || !dirty || saving} className="mt-4 w-full rounded-lg border border-[color-mix(in_srgb,var(--xch-verified)_40%,transparent)] bg-[color-mix(in_srgb,var(--xch-verified)_8%,transparent)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--xch-verified)] transition-opacity duration-150 disabled:opacity-35">
            {t.mandate.save}
          </button>
        </Panel>
      </div>

      <Panel className="xl:col-span-5">
        <PanelHeader icon={ShieldCheck} title={t.invariants.title} sub={t.invariants.sub} />
        <ol className="mt-4 space-y-2">
          {t.invariants.items.map((inv, i) => (
            <li key={i} className="grid grid-cols-[22px_1fr] gap-2 rounded-[10px] border border-[var(--xch-line)] bg-x-ink/[0.025] p-2.5">
              <span className="tnum font-mono text-[10px] text-x-ink/30">{String(i + 1).padStart(2, "0")}</span>
              <div className="min-w-0">
                <p className="text-[12px] leading-relaxed text-x-ink/80">{inv.rule}</p>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <Badge tone="solid">{inv.engine}</Badge>
                  <Badge tone="emerald">{t.invariants.enforced}</Badge>
                  {i === 0 && (
                    <span className="tnum ms-auto font-mono text-[10px] text-x-ink/40" dir="ltr">
                      ≥ {usd(floor)}
                    </span>
                  )}
                  {i === 1 && Object.keys(resources).length > 0 && (
                    <span className="tnum ms-auto truncate font-mono text-[10px] text-x-ink/40" dir="ltr">
                      {Object.entries(resources)
                        .map(([d, r]) => `${num(r.capacity)} ${RESOURCE_UNITS[d as ResourceDimension]}`)
                        .join(" · ")}
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}

type Slider = { key: "costBasisUsd" | "floorPriceUsd" | "anchorPriceUsd" | "autoSettleCeilingUsd" | "minMarginPct"; label: string; color: string };

/**
 * The price corridor: the standing mandate drawn as one line from cost basis to list price, with the effective
 * floor (max of floor, cost ÷ (1 − margin) and the resource floor) computed live by the same function Sovereign
 * uses. Sliders edit the draft; nothing is applied until the mandate is sealed.
 */
function PriceCorridor({ draft, setDraft, onReset, dirty }: { draft: InitiatorMandate; setDraft: React.Dispatch<React.SetStateAction<InitiatorMandate>>; onReset: () => void; dirty: boolean }) {
  const t = useExchangeCopy().mandate;
  const d = useDeskCopy().mandate;
  const floor = effectiveFloor(draft);
  const max = Math.max(1, draft.anchorPriceUsd, draft.autoSettleCeilingUsd, Number.isFinite(floor) ? floor : 0) * 1.25;
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  const valid = InitiatorMandateSchema.safeParse(draft).success;
  const sliders: Slider[] = [
    { key: "costBasisUsd", label: t.fields.costBasisUsd, color: "rgba(22,17,15,0.55)" },
    { key: "floorPriceUsd", label: d.floor, color: "#9c4a17" },
    { key: "anchorPriceUsd", label: d.anchor, color: "#7a5c1e" },
    { key: "autoSettleCeilingUsd", label: d.ceiling, color: "#7a5c1e" },
    { key: "minMarginPct", label: t.fields.minMarginPct, color: "#9f1239" },
  ];
  const markers = [
    { v: draft.costBasisUsd, label: t.fields.costBasisUsd, color: "rgba(22,17,15,0.45)" },
    { v: draft.floorPriceUsd, label: d.floor, color: "#9c4a17" },
    { v: Number.isFinite(floor) ? floor : 0, label: d.effective, color: "#9f1239", strong: true },
    { v: draft.anchorPriceUsd, label: d.anchor, color: "#7a5c1e", strong: true },
    { v: draft.autoSettleCeilingUsd, label: d.ceiling, color: "#7a5c1e" },
  ];
  return (
    <Panel>
      <PanelHeader
        icon={SlidersHorizontal}
        title={d.corridor}
        sub={d.corridorSub}
        right={
          <button type="button" onClick={onReset} disabled={!dirty} className="xch-btn flex items-center gap-1 px-2.5 py-1 text-[11px] text-x-ink/60 hover:text-x-ink disabled:opacity-35">
            <RotateCcw className="size-3" /> {d.reset}
          </button>
        }
      />
      {/* The corridor */}
      <div className="relative mt-10 mb-12 h-2.5 rounded-full bg-x-ink/[0.05]" dir="ltr">
        <div className="absolute inset-y-0 start-0 rounded-s-full bg-[color-mix(in_srgb,var(--xch-threat)_14%,transparent)] transition-[width] duration-200" style={{ width: pct(floor) }} />
        <div className={cn("absolute inset-y-0 rounded-full transition-[left,width] duration-200", valid ? "bg-[linear-gradient(90deg,#d6aa5c,#7a5c1e)]" : "bg-[var(--xch-clamp)]")} style={{ left: pct(floor), width: `calc(${pct(draft.anchorPriceUsd)} - ${pct(floor)})` }} />
        {markers.map((m, i) => (
          <div key={m.label} className="absolute top-1/2 -translate-x-1/2 transition-[left] duration-200" style={{ left: pct(m.v) }}>
            <span className={cn("block -translate-y-1/2 rounded-full border-2 border-white shadow-[0_1px_3px_rgba(40,25,20,0.25)]", m.strong ? "size-4" : "size-3")} style={{ background: m.color }} />
            <span className={cn("absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-center font-mono text-[9.5px] leading-tight", i % 2 ? "top-4" : "-top-9")} style={{ color: m.color }}>
              {m.label}
              <span className="tnum block text-x-ink/70">{usd(m.v)}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {sliders.map((s) => {
          const pctField = s.key === "minMarginPct";
          return (
            <label key={s.key} className="block min-w-0">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate font-mono text-[9.5px] uppercase tracking-[0.14em] text-x-ink/45">{s.label}</span>
                <span className="tnum font-mono text-[11.5px] text-x-ink">{pctField ? `${draft.minMarginPct}%` : usd(draft[s.key])}</span>
              </span>
              <input
                type="range"
                min={0}
                max={pctField ? 90 : Math.round(max)}
                step={pctField ? 0.5 : 50}
                value={draft[s.key]}
                onChange={(e) => setDraft((m) => ({ ...m, [s.key]: Number(e.target.value) }))}
                className="mt-1.5 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-x-ink/[0.07] [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-[var(--thumb)] [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[var(--thumb)] [&::-webkit-slider-thumb]:shadow-[0_1px_3px_rgba(40,25,20,0.35)]"
                style={{ "--thumb": s.color } as React.CSSProperties}
                aria-label={s.label}
              />
            </label>
          );
        })}
      </div>
    </Panel>
  );
}
