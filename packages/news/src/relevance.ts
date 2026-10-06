import type { NewsEvent, NewsImpact } from "./types";

/**
 * Which currencies actually move a given market, and how hard to weigh them.
 *
 * This is deliberately mechanical rather than clever: a currency is relevant
 * because it is a leg of the pair, because the asset is priced in it, or because
 * it drives global risk appetite. Each reason is returned as a key so the UI can
 * say *why* in the user's language instead of us hard-coding English prose here.
 */
export type RelevanceReason = "baseCurrency" | "quoteCurrency" | "pricedIn" | "riskSentiment";

export interface CurrencyRelevance {
  currency: string;
  /** 1 = a leg of the pair, 0.7 = the asset is priced in it, 0.4 = sentiment. */
  weight: number;
  reason: RelevanceReason;
}

const FIAT = new Set([
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CHF",
  "AUD",
  "NZD",
  "CAD",
  "CNY",
  "SEK",
  "NOK",
]);

/** Metals and crypto bases: not currencies, but they are priced in one. */
const PRICED_IN_USD = new Set(["XAU", "XAG", "XPT", "BTC", "ETH", "SOL", "BNB", "XRP"]);

/** Crypto also trades off global risk appetite, where US macro dominates. */
const RISK_DRIVEN = new Set(["BTC", "ETH", "SOL", "BNB", "XRP"]);

function splitSymbol(symbol: string): { base: string; quote: string } {
  const upper = symbol.toUpperCase();
  // Stablecoin quotes first: BTCUSDT must not split as BTCU / SDT.
  for (const quote of ["USDT", "USDC", "BUSD", "FDUSD"]) {
    if (upper.endsWith(quote) && upper.length > quote.length) {
      return { base: upper.slice(0, upper.length - quote.length), quote: "USD" };
    }
  }
  if (upper.length === 6) return { base: upper.slice(0, 3), quote: upper.slice(3) };
  return { base: upper, quote: "" };
}

/**
 * Highest weight wins when a currency qualifies twice (USD is both the quote of
 * XAUUSD and what gold is priced in — it should be listed once, at weight 1).
 */
export function currencyRelevance(symbol: string): CurrencyRelevance[] {
  const { base, quote } = splitSymbol(symbol);
  const found = new Map<string, CurrencyRelevance>();

  const add = (currency: string, weight: number, reason: RelevanceReason): void => {
    if (!currency) return;
    const existing = found.get(currency);
    if (existing && existing.weight >= weight) return;
    found.set(currency, { currency, weight, reason });
  };

  if (FIAT.has(base)) add(base, 1, "baseCurrency");
  if (FIAT.has(quote)) add(quote, 1, "quoteCurrency");
  if (PRICED_IN_USD.has(base)) add("USD", quote === "USD" ? 1 : 0.7, "pricedIn");
  if (RISK_DRIVEN.has(base)) add("USD", Math.max(found.get("USD")?.weight ?? 0, 0.7), "pricedIn");

  return [...found.values()].sort((a, b) => b.weight - a.weight || a.currency.localeCompare(b.currency));
}

export function relevantCurrencies(symbol: string): string[] {
  return currencyRelevance(symbol).map((r) => r.currency);
}

/** Keeps only the events that can move this market, newest-first order preserved. */
export function filterRelevant(events: NewsEvent[], symbol: string, minImpact: NewsImpact = 2): NewsEvent[] {
  const relevant = new Set(relevantCurrencies(symbol));
  return events
    .filter((e) => !e.isHoliday && e.impact >= minImpact && relevant.has(e.currency))
    .sort((a, b) => a.time - b.time);
}

/* -------------------------------------------------------------------------- */
/*  Risk window                                                               */
/* -------------------------------------------------------------------------- */

/** Minutes before a high-impact release where opening a new position is reckless. */
export const BLACKOUT_BEFORE_MIN = 30;
/** Minutes after the release where the spread and the whipsaw are still wrong. */
export const BLACKOUT_AFTER_MIN = 15;
/** Look-ahead for the softer "there is news coming" warning. */
export const CAUTION_BEFORE_MIN = 120;

export type NewsRiskLevel = "clear" | "caution" | "blackout";

export interface NewsRisk {
  level: NewsRiskLevel;
  /** The event that produced the verdict, or the next relevant one when clear. */
  event: NewsEvent | null;
  /** Seconds until the event. Negative once it has already printed. */
  secondsAway: number | null;
  /** Every relevant event inside the look-ahead, earliest first. */
  upcoming: NewsEvent[];
  /**
   * i18n key under `news.risk.*` explaining the verdict. Returned as a key, not
   * a sentence, so Thai and English stay in the locale files.
   */
  reasonKey: "blackout" | "cautionHigh" | "cautionMedium" | "clear" | "noData";
}

/**
 * The news half of "should I be opening a trade right now".
 *
 * Deliberately conservative and deliberately narrow: it answers only "is a
 * scheduled release about to distort this market", never "which way will it
 * go". A blackout is a reason to wait, not a direction.
 */
export function assessNewsRisk(params: {
  events: NewsEvent[];
  symbol: string;
  now: number;
  /** Set false when the calendar could not be loaded at all. */
  haveData?: boolean;
}): NewsRisk {
  const { events, symbol, now } = params;
  if (params.haveData === false) {
    return { level: "clear", event: null, secondsAway: null, upcoming: [], reasonKey: "noData" };
  }

  const relevant = filterRelevant(events, symbol, 2);
  const horizon = now + CAUTION_BEFORE_MIN * 60;
  const upcoming = relevant.filter(
    (e) => e.time >= now - BLACKOUT_AFTER_MIN * 60 && e.time <= horizon,
  );

  const blackout = upcoming.find(
    (e) =>
      e.impact === 3 &&
      e.time - now <= BLACKOUT_BEFORE_MIN * 60 &&
      now - e.time <= BLACKOUT_AFTER_MIN * 60,
  );
  if (blackout) {
    return {
      level: "blackout",
      event: blackout,
      secondsAway: blackout.time - now,
      upcoming,
      reasonKey: "blackout",
    };
  }

  const nextHigh = upcoming.find((e) => e.impact === 3 && e.time > now);
  if (nextHigh) {
    return {
      level: "caution",
      event: nextHigh,
      secondsAway: nextHigh.time - now,
      upcoming,
      reasonKey: "cautionHigh",
    };
  }

  const nextMedium = upcoming.find((e) => e.impact === 2 && e.time > now);
  if (nextMedium) {
    return {
      level: "caution",
      event: nextMedium,
      secondsAway: nextMedium.time - now,
      upcoming,
      reasonKey: "cautionMedium",
    };
  }

  const nextAny = relevant.find((e) => e.time > now) ?? null;
  return {
    level: "clear",
    event: nextAny,
    secondsAway: nextAny ? nextAny.time - now : null,
    upcoming,
    reasonKey: "clear",
  };
}
