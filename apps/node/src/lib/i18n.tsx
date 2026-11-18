"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/** Bloom Exchange ships in English and Spanish. The choice persists per browser. */
export type Lang = "en" | "es";

const KEY = "bloom-lang";
type I18n = { lang: Lang; dir: "ltr"; setLang: (l: Lang) => void };
const I18nContext = createContext<I18n>({ lang: "en", dir: "ltr", setLang: () => {} });

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "en" || saved === "es") setLangState(saved);
    } catch {
      // English.
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      // Not remembered.
    }
  }, []);
  const value = useMemo<I18n>(() => ({ lang, dir: "ltr", setLang }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
