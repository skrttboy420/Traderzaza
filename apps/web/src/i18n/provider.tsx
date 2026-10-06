"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Locale, Phrase } from "@atc/types";
import { renderPhrase, renderPhrases } from "@atc/engine";

import {
  DEFAULT_LOCALE,
  isLocale,
  translate,
  type Namespace,
  type TranslateVars,
} from "./dictionaries";

const STORAGE_KEY = "atc.locale";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  /** True until the stored preference has been read, so SSR and client agree. */
  hydrated: boolean;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [hydrated, setHydrated] = useState(false);

  // Read the persisted choice after mount. Server renders Thai (the default),
  // so the first paint is never wrong for a new visitor.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isLocale(stored) && stored !== locale) {
        setLocaleState(stored);
      }
    } catch {
      // Private mode / storage disabled: stay on the default.
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not fatal: the switch still applies for this session.
    }
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, hydrated }),
    [locale, setLocale, hydrated],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used inside <LocaleProvider>");
  return ctx;
}

export type Translator = (key: string, vars?: TranslateVars) => string;

/** `const t = useT("trading"); t("dashboard.title")` */
export function useT(namespace: Namespace): Translator {
  const { locale } = useLocale();
  return useCallback(
    (key: string, vars?: TranslateVars) => translate(locale, namespace, key, vars),
    [locale, namespace],
  );
}

export interface PhraseRenderer {
  /** One engine phrase in the active locale. */
  (phrase: Phrase): string;
  /** An array of them, for the narrative fields that come as lists. */
  all: (phrases: Phrase[]) => string[];
}

/**
 * Renders engine output in the active locale.
 *
 * Engine phrases deliberately do not go through `useT`: the dictionaries hold
 * the UI chrome (labels, headings, button text) that the web app owns, while
 * the phrase catalogue in `@atc/engine` holds the analysis narrative that the
 * engine owns. Keeping them separate means a sentence lives next to the code
 * that decides when to say it, and `@atc/ai` can render the same sentence in
 * English for the model prompt without importing anything from the web app.
 *
 * `const say = usePhrase(); say(plan.stopLossReason); say.all(setup.whyEnter)`
 */
export function usePhrase(): PhraseRenderer {
  const { locale } = useLocale();
  return useMemo(() => {
    const render = ((phrase: Phrase) => renderPhrase(phrase, locale)) as PhraseRenderer;
    render.all = (phrases: Phrase[]) => renderPhrases(phrases, locale);
    return render;
  }, [locale]);
}

/** For components that need more than one namespace. */
export function useTranslations(): (
  namespace: Namespace,
  key: string,
  vars?: TranslateVars,
) => string {
  const { locale } = useLocale();
  return useCallback(
    (namespace: Namespace, key: string, vars?: TranslateVars) =>
      translate(locale, namespace, key, vars),
    [locale],
  );
}
