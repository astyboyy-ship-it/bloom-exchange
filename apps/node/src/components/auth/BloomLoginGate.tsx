"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Check, Copy, Fingerprint, KeyRound, Loader2, LogOut, Radio, ShieldCheck, Terminal } from "lucide-react";
import { BloomWordmark } from "@/components/bloom/logo";
import { updateSettings, useDeskSettings } from "@/lib/settings";
import { useDeskCopy } from "@/components/exchange/desk-copy";
import { cn } from "@/lib/utils";

/**
 * The entrance to Bloom Exchange: an open-core manifesto on a white gallery wall with one framed garden painting.
 * The sandbox is open to everyone, no key and no account. A Bloom access key is optional: it is verified by the
 * clearinghouse itself (/api/exchange/status reads it exactly as every negotiation does), kept in desk settings on
 * this device, and switches enclaves to live models and binding settlement. Shown once per browser session.
 */
export const SESSION_KEY = "bloom-exchange-session";
export type GateResult = { kind: "key" | "sandbox"; operator: boolean; firstVisit: boolean };

const ONBOARDED_KEY = "bloom-exchange-onboarded";
const EASE = [0.22, 1, 0.36, 1] as const;
const RUN_LOCAL = ["npm install", "npm run dev", "open http://localhost:3000", "npx bloom-verify receipt.json"];

type Status = { licensed: boolean; operator: boolean };

async function verify(key: string): Promise<Status | "unreachable"> {
  try {
    const r = await fetch("/api/exchange/status", { headers: { "x-bloom-license": key }, cache: "no-store" });
    if (!r.ok) return { licensed: false, operator: false };
    return (await r.json()) as Status;
  } catch {
    return "unreachable";
  }
}

const mask = (k: string) => (k.length > 10 ? `${k.slice(0, 6)}…${k.slice(-4)}` : "••••");

export function markSession(kind: "key" | "sandbox") {
  try {
    sessionStorage.setItem(SESSION_KEY, kind);
  } catch {
    // Not remembered: the gate shows again next load.
  }
}

/** Removes the stored key and ends the session; the caller shows the gate again. */
export function signOut() {
  updateSettings({ licenseKey: "" });
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing to clear.
  }
}

const PRINCIPLE_ICONS = [Radio, ShieldCheck, Fingerprint, Terminal];

export function BloomLoginGate({ onEnter }: { onEnter: (r: GateResult) => void }) {
  const t = useDeskCopy().gate;
  const reduce = useReducedMotion() ?? false;
  const { settings } = useDeskSettings();
  const saved = settings.licenseKey.trim();
  const [entering, setEntering] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const finish = (kind: "key" | "sandbox", operator: boolean) => {
    let firstVisit = false;
    try {
      firstVisit = localStorage.getItem(ONBOARDED_KEY) !== "1";
      localStorage.setItem(ONBOARDED_KEY, "1");
    } catch {
      // Treated as a returning visit.
    }
    markSession(kind);
    setEntering(true);
    window.setTimeout(() => onEnter({ kind, operator, firstVisit }), reduce ? 0 : 520);
  };

  const unlock = async (candidate: string) => {
    const k = candidate.trim();
    if (!k || busy) return;
    setBusy(true);
    setError(null);
    const s = await verify(k);
    setBusy(false);
    if (s === "unreachable") return setError(t.unreachable);
    if (!s.licensed) return setError(t.invalid);
    if (k !== saved) updateSettings({ licenseKey: k });
    finish("key", s.operator);
  };

  const copyRun = () =>
    void navigator.clipboard?.writeText(RUN_LOCAL.join("\n")).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });

  return (
    <motion.div className="xch xch-atmosphere xch-scroll fixed inset-0 z-[120] overflow-y-auto" role="dialog" aria-modal="true" aria-label={`Bloom ${t.product}`} initial={{ opacity: 0 }} animate={entering ? { opacity: 0, scale: 1.015 } : { opacity: 1, scale: 1 }} transition={{ duration: entering ? 0.5 : 0.6, ease: EASE }}>
      <div className="pointer-events-none fixed inset-0" aria-hidden>
        <div className="xch-velvet absolute -left-[10%] -top-[20%] h-[60vh] w-[55vw] rounded-full bg-[radial-gradient(closest-side,rgba(122,160,104,0.10),transparent)]" />
        <div className="xch-velvet absolute -bottom-[25%] right-[-5%] h-[70vh] w-[50vw] rounded-full bg-[radial-gradient(closest-side,rgba(214,170,92,0.14),transparent)] [animation-delay:-4s]" />
      </div>

      <div className="relative mx-auto grid min-h-full max-w-[1280px] grid-cols-1 items-center gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)] lg:gap-16 lg:py-14">
        <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.1, ease: EASE }} className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-x-ink/45">{t.kicker}</p>
          <h1 className="mt-5 flex flex-wrap items-baseline gap-x-4 leading-none">
            <span className="text-[44px] sm:text-[60px]">
              <BloomWordmark tone="ink" />
            </span>
            <span className="xch-gold-italic text-[42px] sm:text-[56px]">{t.product}</span>
          </h1>
          <p className="xch-display mt-6 text-[40px] leading-[1.02] text-x-ink sm:text-[56px]">{t.headline}</p>
          <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-x-ink/65">{t.manifesto}</p>

          <ul className="mt-7 grid max-w-2xl grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            {t.principles.map((p, i) => {
              const Icon = PRINCIPLE_ICONS[i] ?? Radio;
              return (
                <li key={p.title} className="flex gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border border-[var(--xch-line-strong)] bg-[var(--xch-card-solid)]">
                    <Icon className="size-3.5 text-x-ink/45" strokeWidth={1.5} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-x-ink">{p.title}</span>
                    <span className="mt-0.5 block text-[12px] leading-relaxed text-x-ink/55">{p.body}</span>
                  </span>
                </li>
              );
            })}
          </ul>

          <div className="mt-8 flex max-w-xl flex-col gap-3">
            <button type="button" onClick={() => finish("sandbox", false)} className="xch-btn-ink flex h-12 w-full items-center justify-center gap-2 text-[14px] font-medium">
              {t.enter} <ArrowRight className="size-4" strokeWidth={1.75} />
            </button>

            {saved && !keyOpen && (
              <div className="flex flex-wrap items-center gap-2 rounded-[7px] border border-[var(--xch-line)] bg-[var(--xch-card-solid)] px-4 py-2 text-[12.5px]">
                <KeyRound className="size-3.5 text-x-ink/45" strokeWidth={1.5} />
                <span className="text-x-ink/55">{t.saved}</span>
                <span className="font-mono text-x-ink/70">{mask(saved)}</span>
                <button type="button" disabled={busy} onClick={() => void unlock(saved)} className="ms-auto flex items-center gap-1 font-medium text-x-ink hover:underline disabled:opacity-50">
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : null} {t.continue}
                </button>
                <button type="button" onClick={() => updateSettings({ licenseKey: "" })} aria-label={t.signOut} title={t.signOut} className="text-x-ink/40 hover:text-[var(--xch-threat)]">
                  <LogOut className="size-3.5" strokeWidth={1.5} />
                </button>
              </div>
            )}
            {error && saved && !keyOpen && (
              <p role="alert" className="text-[12px] text-[var(--xch-threat)]">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={() => {
                setKeyOpen((o) => !o);
                setError(null);
                window.setTimeout(() => input.current?.focus(), 60);
              }}
              aria-expanded={keyOpen}
              className="flex items-center justify-center gap-1.5 self-center text-[12.5px] text-x-ink/55 underline-offset-4 hover:text-x-ink hover:underline"
            >
              <KeyRound className="size-3.5" strokeWidth={1.5} /> {keyOpen ? t.keyHide : saved ? t.useAnother : t.keyOptional}
            </button>
            <AnimatePresence initial={false}>
              {keyOpen && (
                <motion.form
                  key="key"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25, ease: EASE }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void unlock(key);
                  }}
                  className="overflow-hidden"
                >
                  <div className="space-y-2.5 pt-1">
                    <span className={cn("flex h-11 items-center gap-2.5 rounded-[7px] border bg-[var(--xch-card-solid)] px-4 transition-colors duration-150 focus-within:border-x-ink/45", error ? "border-[color-mix(in_srgb,var(--xch-threat)_45%,transparent)]" : "border-[var(--xch-line)]")}>
                      <KeyRound className="size-4 shrink-0 text-x-ink/35" strokeWidth={1.5} />
                      <input ref={input} value={key} onChange={(e) => (setKey(e.target.value), setError(null))} placeholder={t.keyPh} aria-label={t.keyLabel} autoComplete="off" spellCheck={false} className="h-full w-full bg-transparent font-mono text-[13px] text-x-ink outline-none placeholder:font-sans placeholder:text-x-ink/30" />
                      <button type="submit" disabled={!key.trim() || busy} className="xch-btn-ink flex shrink-0 items-center gap-1 px-3 py-1 text-[12px] disabled:opacity-30">
                        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />} {busy ? t.checking : t.unlock}
                      </button>
                    </span>
                    {error && (
                      <p role="alert" className="px-1 text-[12px] leading-relaxed text-[var(--xch-threat)]">
                        {error}
                      </p>
                    )}
                    <p className="px-1 text-[11.5px] leading-relaxed text-x-ink/45">
                      {t.keyWhy} {t.note}
                    </p>
                  </div>
                </motion.form>
              )}
            </AnimatePresence>
          </div>
        </motion.section>

        <motion.aside initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.1, delay: 0.25, ease: EASE }} className="mx-auto w-full max-w-[460px] space-y-4 lg:max-w-none">
          <figure>
            <div className="rounded-[6px] bg-[var(--xch-card-solid)] p-3 shadow-[0_2px_4px_rgba(40,25,20,0.05),0_40px_80px_-40px_rgba(40,25,20,0.35)] ring-1 ring-[var(--xch-line)] sm:p-4">
              <div className="relative aspect-[16/10] overflow-hidden rounded-[2px] ring-1 ring-[var(--xch-line-strong)] lg:aspect-[5/6]">
                <Image src="/paintings/villa-deste.jpg" alt="" fill priority sizes="(min-width: 1024px) 480px, 90vw" quality={75} className="object-cover" />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(31,61,43,0.12),rgba(20,23,14,0.25))]" />
              </div>
            </div>
            <figcaption className="mt-2.5 text-center font-mono text-[9.5px] uppercase tracking-[0.24em] text-x-ink/35">{t.caption}</figcaption>
          </figure>

          {/* Run it yourself */}
          <div className="overflow-hidden rounded-[14px] bg-[#22281a] ring-1 ring-[rgba(226,191,120,0.25)]">
            <div className="flex items-center justify-between border-b border-[rgba(226,191,120,0.15)] px-4 py-2">
              <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[#e2bf78]">
                <Terminal className="size-3.5" strokeWidth={1.5} /> {t.runLocal}
              </span>
              <button type="button" onClick={copyRun} aria-label="Copy" className="text-[rgba(240,236,224,0.6)] transition-colors hover:text-white">
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </button>
            </div>
            <pre className="xch-scroll overflow-x-auto px-4 py-3 font-mono text-[12px] leading-relaxed text-[rgba(240,236,224,0.88)]">
              {RUN_LOCAL.map((l) => (
                <span key={l} className="block">
                  <span className="select-none text-[#e2bf78]/70">$ </span>
                  {l}
                </span>
              ))}
            </pre>
          </div>
        </motion.aside>
      </div>
    </motion.div>
  );
}
