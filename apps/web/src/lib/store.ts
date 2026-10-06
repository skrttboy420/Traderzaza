"use client";

import { useCallback, useEffect, useState } from "react";
import type { Locale, PsychologyTag, Trade, TradeClassification } from "@atc/types";

import { DEFAULT_SETTINGS, mergeSettings, type UserSettings } from "./settings";

/**
 * Browser-local persistence.
 *
 * Supabase is the designed home for this data (see supabase/migrations), but
 * the app must be honest and usable without any backend configured, so when
 * there is no database we keep everything in localStorage and tell the user
 * exactly that (journal.storage.localHint).
 */

const KEYS = {
  settings: "atc.settings",
  journal: "atc.journal",
  rules: "atc.rules",
} as const;

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or private mode: the value stays in memory for this session.
  }
}

/**
 * State that starts from the SSR-safe default and loads from storage after
 * mount, so server and first client render always match.
 */
function usePersisted<T>(key: string, fallback: T, revive: (raw: unknown) => T) {
  const [value, setValue] = useState<T>(fallback);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const raw = read<unknown>(key, null);
    if (raw !== null) setValue(revive(raw));
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        write(key, resolved);
        return resolved;
      });
    },
    [key],
  );

  return { value, update, loaded } as const;
}

export function useSettings() {
  const { value, update, loaded } = usePersisted<UserSettings>(
    KEYS.settings,
    DEFAULT_SETTINGS,
    mergeSettings,
  );

  const patch = useCallback(
    (partial: Partial<UserSettings>) => update((prev) => ({ ...prev, ...partial })),
    [update],
  );

  const reset = useCallback(() => update(DEFAULT_SETTINGS), [update]);

  return { settings: value, patch, setSettings: update, reset, loaded } as const;
}

/** A journal entry is a Trade plus the free-text fields the engine never sets. */
export interface JournalEntry extends Trade {
  /** §64: entries are stored in the language they were written in. */
  language: Locale;
  feeling: string;
  followedPlan: boolean | null;
  createdAt: number;
}

export function emptyEntry(symbol: string, language: Locale): JournalEntry {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: `j-${now}-${Math.random().toString(36).slice(2, 8)}`,
    symbol,
    timeframe: "15m",
    direction: "long",
    entryType: "confirmation",
    entryPrice: 0,
    stopLoss: 0,
    takeProfits: [],
    size: 0,
    openedAt: now,
    closedAt: null,
    exitPrice: null,
    mfeR: null,
    maeR: null,
    resultR: null,
    classification: null,
    psychology: [],
    setupId: null,
    notes: "",
    language,
    feeling: "",
    followedPlan: null,
    createdAt: now,
  };
}

function reviveJournal(raw: unknown): JournalEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is JournalEntry => typeof e === "object" && e !== null && "id" in e);
}

export function useJournal() {
  const { value, update, loaded } = usePersisted<JournalEntry[]>(KEYS.journal, [], reviveJournal);

  const save = useCallback(
    (entry: JournalEntry) =>
      update((prev) => {
        const index = prev.findIndex((e) => e.id === entry.id);
        if (index === -1) return [entry, ...prev];
        const next = [...prev];
        next[index] = entry;
        return next;
      }),
    [update],
  );

  const remove = useCallback(
    (id: string) => update((prev) => prev.filter((e) => e.id !== id)),
    [update],
  );

  const classify = useCallback(
    (id: string, classification: TradeClassification, psychology: PsychologyTag[]) =>
      update((prev) =>
        prev.map((e) => (e.id === id ? { ...e, classification, psychology } : e)),
      ),
    [update],
  );

  const open = value.filter((e) => e.closedAt === null);
  const closed = value.filter((e) => e.closedAt !== null);

  return { entries: value, open, closed, save, remove, classify, loaded } as const;
}

export interface TradingRule {
  id: string;
  text: string;
  active: boolean;
  createdAt: number;
}

function reviveRules(raw: unknown): TradingRule[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is TradingRule => typeof r === "object" && r !== null && "text" in r);
}

export function useRules() {
  const { value, update, loaded } = usePersisted<TradingRule[]>(KEYS.rules, [], reviveRules);

  const add = useCallback(
    (text: string) =>
      update((prev) => [
        {
          id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          text,
          active: true,
          createdAt: Math.floor(Date.now() / 1000),
        },
        ...prev,
      ]),
    [update],
  );

  const toggle = useCallback(
    (id: string) => update((prev) => prev.map((r) => (r.id === id ? { ...r, active: !r.active } : r))),
    [update],
  );

  const remove = useCallback((id: string) => update((prev) => prev.filter((r) => r.id !== id)), [update]);

  return { rules: value, add, toggle, remove, loaded } as const;
}

export function clearLocalData(): void {
  if (typeof window === "undefined") return;
  for (const key of Object.values(KEYS)) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}

export function exportLocalData(): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      settings: read(KEYS.settings, DEFAULT_SETTINGS),
      journal: read<JournalEntry[]>(KEYS.journal, []),
      rules: read<TradingRule[]>(KEYS.rules, []),
    },
    null,
    2,
  );
}
