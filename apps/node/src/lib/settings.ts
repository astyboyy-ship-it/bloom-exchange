"use client";

import { useSyncExternalStore } from "react";

/**
 * The desk's per-device settings: the optional Bloom access key and, for own-key mode, model provider keys sent
 * with each request (never stored server-side). Kept in localStorage on this device only.
 */
export type DeskSettings = { licenseKey: string; keys: { anthropic: string; openrouter: string } };

const KEY = "bloom-exchange-settings";
const DEFAULT: DeskSettings = { licenseKey: "", keys: { anthropic: "", openrouter: "" } };
const listeners = new Set<() => void>();
let cache: DeskSettings | null = null;

function read(): DeskSettings {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<DeskSettings>) : {};
    cache = { ...DEFAULT, ...parsed, keys: { ...DEFAULT.keys, ...parsed.keys } };
  } catch {
    cache = DEFAULT;
  }
  return cache;
}

export function updateSettings(patch: Partial<DeskSettings>) {
  cache = { ...read(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Kept in memory for this session.
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useDeskSettings() {
  const settings = useSyncExternalStore(subscribe, read, () => DEFAULT);
  return { settings };
}

/** Headers every desk request carries: the access key the clearinghouse verifies, plus own model keys if set. */
export function requestHeaders(s: DeskSettings): Record<string, string> {
  return {
    ...(s.licenseKey.trim() && { "x-bloom-license": s.licenseKey.trim() }),
    ...(s.keys.anthropic.trim() && { "x-anthropic-key": s.keys.anthropic.trim() }),
    ...(s.keys.openrouter.trim() && { "x-openrouter-key": s.keys.openrouter.trim() }),
  };
}
