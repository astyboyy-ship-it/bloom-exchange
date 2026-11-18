"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { BotanicalSprig } from "@/components/art/Botanical";
import { BloomWordmark } from "@/components/bloom/logo";

/**
 * The native window around Bloom Exchange. In the desktop app (Tauri, frameless window) it draws the title bar:
 * a drag region (double-click maximizes), the Bloom wordmark, and quiet ink window controls wired to the native
 * window. In a browser it keeps the same chrome without controls, so the terminal never feels like a web tab.
 * Shortcuts: ⌘/Ctrl+R refreshes telemetry instead of reloading the page (⌘/Ctrl+K stays with the command palette).
 * The atmosphere is a painting under glass: alabaster parchment with grain, a garden painting held faintly behind
 * it, twilight olive in the corners and a varnish-deep vignette. Everything here is static except two slow glows.
 */

export const REFRESH_EVENT = "xch:refresh";

type TauriWindow = { minimize: () => Promise<void>; toggleMaximize: () => Promise<void>; close: () => Promise<void>; isMaximized: () => Promise<boolean>; onResized: (cb: () => void) => Promise<() => void> };
type TauriGlobal = { window?: { getCurrentWindow?: () => TauriWindow } };

function nativeWindow(): TauriWindow | null {
  const t = (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__;
  try {
    return t?.window?.getCurrentWindow?.() ?? null;
  } catch {
    return null;
  }
}

/** Quiet ink controls; colour only where it means something (close turns crimson under the pointer). */
function Control({ label, danger, onClick, glyph }: { label: string; danger?: boolean; onClick: () => void; glyph: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={`group grid size-[13px] place-items-center rounded-full bg-x-ink/[0.13] shadow-[inset_0_0_0_1px_rgba(21,19,15,0.18)] transition-colors duration-200 hover:bg-x-ink/30 ${danger ? "hover:bg-[var(--xch-threat)]" : ""}`}>
      <span className="opacity-0 transition-opacity duration-200 group-hover:opacity-100">{glyph}</span>
    </button>
  );
}

/** `veiled`: while a full-screen overlay covers the desk, skip painting the atmosphere entirely. */
export function DesktopFrame({ title, veiled = false, children }: { title: string; veiled?: boolean; children: React.ReactNode }) {
  const [win, setWin] = useState<TauriWindow | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    const w = nativeWindow();
    setWin(w);
    if (!w) return;
    let unlisten: (() => void) | undefined;
    const sync = () => void w.isMaximized().then(setMaximized).catch(() => undefined);
    sync();
    void w.onResized(sync).then((u) => (unlisten = u)).catch(() => undefined);
    return () => unlisten?.();
  }, []);

  const refresh = useCallback(() => {
    window.dispatchEvent(new CustomEvent(REFRESH_EVENT));
    setPulse((n) => n + 1);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        refresh();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refresh]);

  const glyph = (d: string) => (
    <svg viewBox="0 0 10 10" className="size-[7px]" aria-hidden>
      <path d={d} stroke="#fdfbf5" strokeWidth={1.4} strokeLinecap="round" fill="none" />
    </svg>
  );

  return (
    <div className="xch xch-atmosphere relative flex h-dvh flex-col overflow-hidden" dir="ltr">
      {/* Atmosphere: a whisper of a garden painting behind the glass, gold-leaf botanical engraving at two corners, slow light, a soft vignette. All static except the light. */}
      <div className={`pointer-events-none fixed inset-0 ${veiled ? "invisible" : ""}`} aria-hidden>
        <Image src="/paintings/golden-landscape.jpg" alt="" fill sizes="100vw" quality={75} className="object-cover opacity-[0.05] saturate-[0.5] sepia-[0.3]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(250,249,246,0.4),rgba(250,249,246,0.9)_40%,rgba(250,249,246,0.96))]" />
        <div className="xch-velvet absolute -left-[12%] -bottom-[18%] h-[60vh] w-[55vw] rounded-full bg-[radial-gradient(closest-side,rgba(74,88,52,0.06),transparent)]" />
        <div className="xch-velvet absolute -right-[8%] -top-[22%] h-[65vh] w-[50vw] rounded-full bg-[radial-gradient(closest-side,rgba(196,160,92,0.1),transparent)] [animation-delay:-5s]" />
        <BotanicalSprig className="absolute bottom-0 left-0 h-[46vh] w-auto" opacity={0.42} />
        <BotanicalSprig mirror className="absolute right-0 top-9 h-[34vh] w-auto -scale-y-100" opacity={0.28} />
        <div className="xch-vignette absolute inset-0" />
      </div>

      <header className="xch-titlebar relative z-50 flex h-9 shrink-0 items-center gap-3 border-b border-[var(--xch-line-strong)] bg-[var(--xch-card-solid)]/75 px-3 backdrop-blur-xl" data-tauri-drag-region>
        {win && (
          <div className="flex items-center gap-2" data-no-drag>
            <Control label="Close" danger onClick={() => void win.close()} glyph={glyph("M2.5 2.5l5 5M7.5 2.5l-5 5")} />
            <Control label="Minimize" onClick={() => void win.minimize()} glyph={glyph("M2 5h6")} />
            <Control label={maximized ? "Restore" : "Maximize"} onClick={() => void win.toggleMaximize()} glyph={glyph(maximized ? "M3 6.5h4M3 3.5h4" : "M5 2v6M2 5h6")} />
          </div>
        )}
        <div className="pointer-events-none flex min-w-0 items-baseline gap-2" data-tauri-drag-region>
          <span className="text-[15px] leading-none">
            <BloomWordmark tone="ink" />
          </span>
          <span className="xch-gold-italic truncate text-[17px] leading-none">{title}</span>
        </div>
        <div className="pointer-events-none ms-auto hidden items-center gap-3 font-mono text-[10px] text-x-ink/35 sm:flex" data-tauri-drag-region>
          <span>⌘K</span>
          <span className="text-x-ink/15">·</span>
          <span>⌘R</span>
        </div>
        {/* A gold hairline sweeps the title bar on every telemetry refresh */}
        {pulse > 0 && <motion.span key={pulse} aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-px origin-left bg-gradient-to-r from-transparent via-[var(--xch-verified)] to-transparent" initial={{ scaleX: 0, opacity: 1 }} animate={{ scaleX: 1, opacity: 0 }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />}
      </header>

      <div className="xch-scroll relative z-10 min-h-0 flex-1 overflow-y-auto overflow-x-hidden">{children}</div>
    </div>
  );
}
