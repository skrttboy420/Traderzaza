import type { Locale } from "@atc/types";

import enCommon from "./locales/en/common.json";
import enTrading from "./locales/en/trading.json";
import enCoach from "./locales/en/coach.json";
import enJournal from "./locales/en/journal.json";
import enSettings from "./locales/en/settings.json";
import enNews from "./locales/en/news.json";
import enGuide from "./locales/en/guide.json";
import thCommon from "./locales/th/common.json";
import thTrading from "./locales/th/trading.json";
import thCoach from "./locales/th/coach.json";
import thJournal from "./locales/th/journal.json";
import thSettings from "./locales/th/settings.json";
import thNews from "./locales/th/news.json";
import thGuide from "./locales/th/guide.json";

export const NAMESPACES = [
  "common",
  "trading",
  "coach",
  "journal",
  "settings",
  "news",
  "guide",
] as const;

export type Namespace = (typeof NAMESPACES)[number];

/** A locale JSON file: nested objects of strings, arbitrary depth. */
export type DictionaryNode = { [key: string]: string | DictionaryNode };

export type Dictionary = Record<Namespace, DictionaryNode>;

export const DICTIONARIES: Record<Locale, Dictionary> = {
  th: {
    common: thCommon as DictionaryNode,
    trading: thTrading as DictionaryNode,
    coach: thCoach as DictionaryNode,
    journal: thJournal as DictionaryNode,
    settings: thSettings as DictionaryNode,
    news: thNews as DictionaryNode,
    guide: thGuide as DictionaryNode,
  },
  en: {
    common: enCommon as DictionaryNode,
    trading: enTrading as DictionaryNode,
    coach: enCoach as DictionaryNode,
    journal: enJournal as DictionaryNode,
    settings: enSettings as DictionaryNode,
    news: enNews as DictionaryNode,
    guide: enGuide as DictionaryNode,
  },
};

/** §65 default language is Thai. */
export const DEFAULT_LOCALE: Locale = "th";

export const LOCALES: Locale[] = ["th", "en"];

export function isLocale(value: unknown): value is Locale {
  return value === "th" || value === "en";
}

/** Walks a dotted path such as `nav.home` inside one namespace. */
export function lookup(node: DictionaryNode, path: string): string | undefined {
  const parts = path.split(".");
  let current: string | DictionaryNode | undefined = node;
  for (const part of parts) {
    if (typeof current !== "object" || current === null) return undefined;
    current = current[part];
  }
  return typeof current === "string" ? current : undefined;
}

export type TranslateVars = Record<string, string | number>;

/** Replaces `{{name}}` placeholders. Unknown placeholders are left visible on purpose. */
export function interpolate(template: string, vars?: TranslateVars): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = vars[key];
    return value === undefined ? match : String(value);
  });
}

/**
 * Resolves one key. Falls back: requested locale -> the other locale -> the key
 * itself. Returning the key (instead of an empty string) makes a missing
 * translation obvious in the UI rather than silently blank.
 */
export function translate(
  locale: Locale,
  namespace: Namespace,
  key: string,
  vars?: TranslateVars,
): string {
  const primary = lookup(DICTIONARIES[locale][namespace], key);
  if (primary !== undefined) return interpolate(primary, vars);

  const fallbackLocale: Locale = locale === "th" ? "en" : "th";
  const fallback = lookup(DICTIONARIES[fallbackLocale][namespace], key);
  if (fallback !== undefined) return interpolate(fallback, vars);

  return `${namespace}.${key}`;
}
