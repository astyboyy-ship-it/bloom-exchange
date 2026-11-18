"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CornerDownLeft, Search, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useExchangeCopy } from "./copy";
import { Kbd, SPRING } from "./ui";

export type PaletteItem = { id: string; group: "views" | "actions"; label: string; hint?: string; icon: LucideIcon; run: () => void };

/** Matches every whitespace-separated term in the label, hint or id, so English keywords work in every language. */
const matches = (item: PaletteItem, q: string) => {
  const hay = `${item.label} ${item.hint ?? ""} ${item.id.replace(/-/g, " ")}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term));
};

export function CommandPalette({ open, onClose, items }: { open: boolean; onClose: () => void; items: PaletteItem[] }) {
  const t = useExchangeCopy().palette;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => items.filter((i) => matches(i, query)), [items, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);
  useEffect(() => setActive(0), [query]);

  const choose = (i: PaletteItem | undefined) => {
    if (!i) return;
    onClose();
    i.run();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(filtered.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(filtered[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  let index = -1;
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="bd" className="fixed inset-0 z-[80] bg-x-ink/25" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} onClick={onClose} />
          <motion.div
            key="palette"
            role="dialog"
            aria-modal="true"
            aria-label={t.placeholder}
            className="fixed inset-x-3 top-[14vh] z-[90] mx-auto max-w-[560px] overflow-hidden rounded-[14px] border border-[var(--xch-line-strong)] bg-[var(--xch-card-solid)] shadow-[0_32px_80px_-24px_rgba(40,25,20,0.16)]"
            initial={{ opacity: 0, scale: 0.97, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -4 }}
            transition={SPRING}
            onKeyDown={onKey}
          >
            <div className="flex items-center gap-2.5 border-b border-[var(--xch-line)] px-4">
              <Search className="size-4 shrink-0 text-x-ink/40" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.placeholder}
                role="combobox"
                aria-expanded="true"
                aria-controls="xch-palette-list"
                aria-activedescendant={filtered[active] ? `xch-pi-${filtered[active].id}` : undefined}
                className="h-12 w-full bg-transparent text-[14px] text-x-ink outline-none placeholder:text-x-ink/30"
              />
              <Kbd>esc</Kbd>
            </div>
            <ul id="xch-palette-list" role="listbox" className="max-h-[50vh] xch-scroll overflow-y-auto p-1.5">
              {filtered.length === 0 && <li className="px-3 py-6 text-center text-[12px] text-x-ink/40">{t.empty}</li>}
              {(["views", "actions"] as const).map((g) => {
                const group = filtered.filter((i) => i.group === g);
                if (!group.length) return null;
                return (
                  <li key={g}>
                    <p className="px-2.5 pb-1 pt-2 font-mono text-[9.5px] uppercase tracking-[0.16em] text-x-ink/30">{t[g]}</p>
                    <ul>
                      {group.map((item) => {
                        index++;
                        const i = index;
                        const Icon = item.icon;
                        return (
                          <li key={item.id} id={`xch-pi-${item.id}`} role="option" aria-selected={i === active}>
                            <button type="button" onMouseMove={() => setActive(i)} onClick={() => choose(item)} className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-[13px] transition-colors duration-100", i === active ? "bg-x-ink/[0.07] text-x-ink" : "text-x-ink/70")}>
                              <Icon className="size-4 shrink-0 text-x-ink/45" strokeWidth={1.75} />
                              <span className="min-w-0 flex-1 truncate">{item.label}</span>
                              {item.hint && <span className="shrink-0 font-mono text-[10px] text-x-ink/35">{item.hint}</span>}
                              {i === active && <CornerDownLeft className="size-3.5 shrink-0 text-x-ink/40" />}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center gap-3 border-t border-[var(--xch-line)] px-4 py-2 font-mono text-[10px] text-x-ink/35">
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> {t.hint}
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↵</Kbd> {t.open}
              </span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
