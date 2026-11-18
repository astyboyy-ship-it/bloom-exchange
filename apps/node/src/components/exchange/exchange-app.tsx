"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, MotionConfig, motion, useAnimationControls } from "framer-motion";
import { Activity, BookOpen, Boxes, Code2, Command, Copy, Crosshair, ExternalLink, Grid3x3, Handshake, Info, KeyRound, LayoutDashboard, LogOut, Network, ScanSearch, Server, Swords, Target, Zap } from "lucide-react";
import { toast } from "sonner";

import { BloomLoginGate, SESSION_KEY, signOut, type GateResult } from "@/components/auth/BloomLoginGate";
import { DesktopFrame } from "@/components/desktop/DesktopFrame";
import type { MacroDomain } from "@bloom-exchange/core/omni-adapter";
import { cn } from "@/lib/utils";
import { ClearingLedgerView } from "./ClearingLedgerView";
import { CommandPalette, type PaletteItem } from "./command-palette";
import { useExchangeCopy, type ExchangeView } from "./copy";
import { useDeskCopy, useExchangeLang, type ExchangeLang, type GuideModuleId } from "./desk-copy";
import { EnclaveInspectorView } from "./EnclaveInspectorView";
import { GardenIntro, INTRO_KEY } from "./GardenIntro";
import { GlobalPulse, usePulse } from "./GlobalPulse";
import { GuideAndShowcaseHub } from "./GuideAndShowcaseHub";
import { MacroMandateView } from "./MacroMandateView";
import { NegotiationSandbox } from "./NegotiationSandbox";
import { OmniProtocolView } from "./OmniProtocolView";
import { useOmniCopy } from "./omni-copy";
import { OverviewDashboard } from "./OverviewDashboard";
import type { ScenarioId } from "./scenarios";
import { quickstart, SdkView } from "./sdk-view";
import { SovereignConsole, SovereignToggle, type ConsoleMode } from "./SovereignToggle";
import { Badge, Kbd, SPRING } from "./ui";
import { useExchange } from "./use-exchange";

const VIEWS: { id: ExchangeView; icon: typeof Activity; key: string }[] = [
  { id: "overview", icon: LayoutDashboard, key: "1" },
  { id: "sandbox", icon: Handshake, key: "2" },
  { id: "guide", icon: BookOpen, key: "3" },
  { id: "ledger", icon: Activity, key: "4" },
  { id: "intents", icon: Network, key: "5" },
  { id: "mandate", icon: Grid3x3, key: "6" },
  { id: "inspector", icon: ScanSearch, key: "7" },
  { id: "sdk", icon: Code2, key: "8" },
];
const SOVEREIGN_VIEW = { id: "sovereign" as ExchangeView, icon: Server, key: "9" };
const MODE_KEY = "bloom-exchange-mode";
const VIEW_KEY = "bloom-exchange-view";
const SCENARIO_ICONS: Record<ScenarioId, typeof Target> = { standard: Target, adversarial: Swords, swarm: Boxes, breach: Crosshair };

const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)));
};

/** EN / ES. The Exchange ships in two languages; the choice is shared with the rest of Bloom AI. */
function LanguageToggle() {
  const { lang, setLang } = useExchangeLang();
  const t = useDeskCopy().lang;
  return (
    <div role="radiogroup" aria-label={t.label} className="inline-flex rounded-[8px] border border-[var(--xch-line-strong)] bg-[var(--xch-card-solid)] p-0.5">
      {(["en", "es"] as ExchangeLang[]).map((l) => (
        <button key={l} type="button" role="radio" aria-checked={lang === l} onClick={() => setLang(l)} className={cn("rounded-[7px] px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors duration-150", lang === l ? "xch-btn-ink" : "text-x-ink/50 hover:text-x-ink")}>
          {l}
        </button>
      ))}
    </div>
  );
}

/**
 * The Bloom Exchange operating desk, served at the node's root. A standalone product with its own gate: an access key (verified
 * by the clearinghouse) or the sandbox. Keyboard-first: ⌘K palette, ⌘R telemetry refresh, 1–9 for views.
 */
export function ExchangeApp() {
  const t = useExchangeCopy();
  const o = useOmniCopy();
  const g = useDeskCopy().gate;
  const { lang } = useExchangeLang();
  const x = useExchange();
  const [injectOpen, setInjectOpen] = useState(false);
  const [domain, setDomain] = useState<MacroDomain | "all">("all");
  const [mode, setModeState] = useState<ConsoleMode>("cloud");
  const desk = useAnimationControls();
  const stats = usePulse(x.pulseTick);

  // The gate: null until this session's state is read (the layout's inline script lifts the veil for a session).
  // The garden intro plays over the gate once per session (never under reduced motion).
  const [gate, setGate] = useState<boolean | null>(null);
  const [intro, setIntro] = useState(false);
  // While the intro is opaque nothing beneath it is painted; it reappears the moment dawn begins.
  const [dawned, setDawned] = useState(false);
  const veiled = intro && !dawned;
  useEffect(() => {
    let inSession = false;
    let introSeen = false;
    try {
      inSession = sessionStorage.getItem(SESSION_KEY) !== null;
      introSeen = sessionStorage.getItem(INTRO_KEY) !== null;
    } catch {
      // No storage: show the gate.
    }
    setGate(!inSession);
    setIntro(!inSession && !introSeen && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  useEffect(() => {
    if (gate) desk.set({ opacity: 0, scale: 0.985 });
  }, [gate, desk]);

  const [view, setViewState] = useState<ExchangeView>("overview");
  useEffect(() => {
    try {
      const m = localStorage.getItem(MODE_KEY);
      if (m === "sovereign") setModeState("sovereign");
      const saved = localStorage.getItem(VIEW_KEY) as ExchangeView | null;
      if (saved && (VIEWS.some((v) => v.id === saved) || (saved === "sovereign" && m === "sovereign"))) setViewState(saved);
    } catch {
      // Starts on the overview.
    }
  }, []);
  const setView = useCallback((v: ExchangeView) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Not remembered; fine.
    }
  }, []);

  const enter = useCallback(
    (r: GateResult) => {
      if (r.firstVisit) setView("sandbox");
      setGate(false);
      void desk.start({ opacity: 1, scale: 1, transition: SPRING });
    },
    [desk, setView],
  );
  const leave = useCallback(() => {
    signOut();
    setGate(true);
  }, []);

  const setMode = useCallback(
    (m: ConsoleMode) => {
      setModeState(m);
      try {
        localStorage.setItem(MODE_KEY, m);
      } catch {
        // Not remembered; fine.
      }
      setView(m === "sovereign" ? "sovereign" : "overview");
    },
    [setView],
  );
  const views = useMemo(() => (mode === "sovereign" ? [...VIEWS, SOVEREIGN_VIEW] : VIEWS), [mode]);

  const [selected, setSelected] = useState<string | null>(null);
  const inspect = useCallback(
    (taskId: string) => {
      setSelected(taskId);
      setView("inspector");
    },
    [setView],
  );
  const openInject = useCallback(() => {
    setView("intents");
    setInjectOpen(true);
  }, [setView]);
  const fire = useCallback(
    (s: ScenarioId) => {
      setView("ledger");
      void x.fire(s);
    },
    [setView, x],
  );
  const guideAction = useCallback(
    (id: GuideModuleId) => {
      if (id === "sandbox") setView("inspector");
      else if (id === "stack") setView("mandate");
      else if (id === "settle") setView("sandbox");
    },
    [setView],
  );

  const [palette, setPalette] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (gate || intro) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
        return;
      }
      if (palette || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const v = views.find((x) => x.key === e.key);
      if (v) setView(v.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gate, intro, palette, setView, views]);

  const items = useMemo<PaletteItem[]>(
    () => [
      ...views.map((v) => ({ id: `view-${v.id}`, group: "views" as const, label: t.views[v.id], hint: v.key, icon: v.icon, run: () => setView(v.id) })),
      { id: "mode-toggle", group: "actions" as const, label: mode === "sovereign" ? o.sovereign.cloud : o.sovereign.node, hint: "sovereign", icon: mode === "sovereign" ? ExternalLink : Server, run: () => setMode(mode === "sovereign" ? "cloud" : "sovereign") },
      ...(["standard", "adversarial", "swarm", "breach"] as ScenarioId[]).map((s) => ({ id: `fire-${s}`, group: "actions" as const, label: `${t.palette.fire}: ${t.stress.scenarios[s].name}`, icon: SCENARIO_ICONS[s], run: () => fire(s) })),
      { id: "inject", group: "actions", label: o.hero.inject, hint: "omni", icon: Zap, run: openInject },
      { id: "card", group: "actions", label: t.palette.card, hint: "/.well-known", icon: ExternalLink, run: () => window.open("/.well-known/agent-card.json", "_blank", "noopener") },
      { id: "copy", group: "actions", label: t.palette.copy, icon: Copy, run: () => void navigator.clipboard?.writeText(quickstart(window.location.origin)).then(() => toast.success(t.sdk.copied)) },
      { id: "sign-out", group: "actions", label: g.signOut, icon: LogOut, run: leave },
    ],
    [t, o, g, setView, views, mode, setMode, fire, openInject, leave],
  );

  const s = x.status;
  return (
    <MotionConfig reducedMotion="user">
    <DesktopFrame title={t.header.product} veiled={veiled}>
      <div className={cn("relative", veiled && "invisible")} lang={lang}>
        <header className="sticky top-0 z-40 border-b border-[var(--xch-line)] bg-[var(--xch-paper)]/80 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-6">
            <button type="button" onClick={() => setPalette(true)} className="xch-btn order-last flex h-8 w-full items-center gap-2 px-3 text-[12px] text-x-ink/40 hover:text-x-ink/70 md:order-none md:w-72">
              <Command className="size-3.5" /> <span className="flex-1 truncate text-start">{t.header.search}</span>
              <Kbd>⌘K</Kbd>
            </button>
            <div className="ms-auto flex flex-wrap items-center gap-2">
              <SovereignToggle mode={mode} onChange={setMode} />
              {s && (
                <>
                  <Badge tone={s.source === "live" ? "emerald" : "solid"}>{s.source === "live" ? t.header.live : t.header.simulated}</Badge>
                  <Badge tone={s.operator ? "emerald" : "muted"}>{s.operator ? t.header.operator : s.licensed ? t.header.production : t.header.sandbox}</Badge>
                  <span className="tnum hidden items-center gap-1 font-mono text-[10px] text-x-ink/40 xl:flex" title={t.header.key}>
                    <KeyRound className="size-3" /> {s.kid}
                  </span>
                </>
              )}
              <LanguageToggle />
              <button type="button" onClick={leave} aria-label={g.signOut} title={g.signOut} className="xch-btn grid size-7 place-items-center text-x-ink/55 hover:text-[var(--xch-threat)]">
                <LogOut className="size-3.5" strokeWidth={1.6} />
              </button>
            </div>
          </div>
          <nav className="xch-noscroll mx-auto flex max-w-[1600px] gap-1 overflow-x-auto px-3 pb-2 [mask-image:linear-gradient(90deg,transparent,#000_12px,#000_calc(100%-12px),transparent)] sm:px-5" role="tablist" aria-label="Views">
            {views.map((v) => {
              const Icon = v.icon;
              const active = view === v.id;
              return (
                <button key={v.id} type="button" role="tab" aria-selected={active} onClick={() => setView(v.id)} className={cn("relative flex shrink-0 items-center gap-2 rounded-[7px] px-3 py-1.5 text-[12.5px] transition-colors duration-150", active ? "text-x-ink" : "text-x-ink/50 hover:text-x-ink/85")}>
                  {active && <motion.span layoutId="xch-view" className="absolute inset-0 rounded-[7px] border border-[var(--xch-line-strong)] bg-[var(--xch-card-solid)] shadow-[inset_0_1px_0_#fff,0_2px_6px_-2px_rgba(40,30,15,0.12)]" transition={SPRING} />}
                  <Icon className="relative size-3.5" strokeWidth={1.6} />
                  <span className="relative">{t.views[v.id]}</span>
                  <Kbd className="relative hidden xl:inline-flex">{v.key}</Kbd>
                </button>
              );
            })}
          </nav>
          <GlobalPulse stats={stats} mode={mode} />
        </header>

        <motion.main animate={desk} className="mx-auto max-w-[1600px] px-4 pb-16 pt-5 sm:px-6">
          {s && !s.licensed && (
            <p className="mb-4 flex items-start gap-2 rounded-[12px] border border-[var(--xch-line)] bg-[var(--xch-card-solid)]/70 px-3.5 py-2.5 text-[12px] leading-relaxed text-x-ink/60">
              <Info className="mt-0.5 size-3.5 shrink-0 text-x-ink/45" /> {t.notice.sandbox}
            </p>
          )}
          <AnimatePresence mode="wait">
            <motion.div key={view} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={SPRING}>
              {view === "overview" && (
                <OverviewDashboard
                  x={x}
                  stats={stats}
                  mode={mode}
                  onInspect={inspect}
                  onFire={() => {
                    setView("sandbox");
                    void x.fire("standard");
                  }}
                  onInject={openInject}
                  onGuide={() => setView("guide")}
                  onSdk={() => setView("sdk")}
                  onDomain={(d) => {
                    setDomain(d);
                    setView("intents");
                  }}
                />
              )}
              {view === "sandbox" && <NegotiationSandbox x={x} onInspect={inspect} />}
              {view === "guide" && <GuideAndShowcaseHub onAction={guideAction} />}
              {view === "ledger" && <ClearingLedgerView x={x} onInspect={inspect} />}
              {view === "intents" && <OmniProtocolView x={x} onOpenEnclave={inspect} injectOpen={injectOpen} setInjectOpen={setInjectOpen} domain={domain} setDomain={setDomain} />}
              {view === "mandate" && <MacroMandateView x={x} />}
              {view === "inspector" && <EnclaveInspectorView x={x} selected={selected} onSelect={setSelected} />}
              {view === "sdk" && <SdkView x={x} />}
              {view === "sovereign" && <SovereignConsole headers={x.headers} />}
            </motion.div>
          </AnimatePresence>
        </motion.main>
      </div>

      <CommandPalette open={palette} onClose={() => setPalette(false)} items={items} />
      {gate === null && <div className="xch-gate-veil fixed inset-0 z-[120] bg-[var(--xch-paper)]" aria-hidden />}
      <AnimatePresence>{gate && (<div key="gate" className={veiled ? "invisible" : undefined}><BloomLoginGate onEnter={enter} /></div>)}</AnimatePresence>
      {intro && <GardenIntro onDawn={() => setDawned(true)} onDone={() => setIntro(false)} />}
    </DesktopFrame>
    </MotionConfig>
  );
}
