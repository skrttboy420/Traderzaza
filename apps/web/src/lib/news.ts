import type { Candle, DataStatus, Timeframe } from "@atc/types";
import {
  NewsService,
  assessNewsRisk,
  calendarWindow,
  filterRelevant,
  readTendency,
  relevantCurrencies,
  studyReactions,
} from "@atc/news";
import type {
  NewsEvent,
  NewsEventHistory,
  NewsImpact,
  NewsRisk,
  ReactionReading,
  ReactionStudy,
} from "@atc/news";

import { serverEnv } from "./env";
import { marketService } from "./scan";

/**
 * Server-side news entry point, the mirror of `scan.ts`.
 *
 * Two jobs, and the split matters:
 *
 *  - WHAT IS COMING (`symbolNews`): the schedule and each release's impact
 *    strength, filtered to the currencies that actually move the symbol, plus a
 *    blackout verdict. Cheap, cached, rendered on every setup.
 *  - WHAT HAPPENED LAST TIME (`eventReaction`): for one recurring event, how
 *    this market moved in the 30 minutes after each past release, split by
 *    whether the print beat or missed. Expensive, so cached hard.
 *
 * Nothing here predicts a number or a direction. The reaction study is a
 * measurement of the past, and the UI has to present it as one.
 */

let cachedNews: NewsService | null = null;

export function newsService(): NewsService {
  if (cachedNews) return cachedNews;
  const env = serverEnv();
  cachedNews = NewsService.fromConfig({
    enableTradingView: env.newsEnabled,
    enableForexFactory: env.newsEnabled,
    enableInvesting: env.newsInvesting,
    ttlSeconds: env.newsTtlSeconds,
  });
  return cachedNews;
}

export interface SymbolNews {
  symbol: string;
  /** Only releases from currencies that move this symbol, impact >= minImpact. */
  events: NewsEvent[];
  risk: NewsRisk;
  currencies: string[];
  provider: string;
  demo: boolean;
  note?: string;
  fetchedAt: number;
}

export interface SymbolNewsOptions {
  minImpact?: NewsImpact;
  pastHours?: number;
  aheadHours?: number;
  now?: number;
  /** Cap on rows returned to the browser. */
  limit?: number;
}

export async function symbolNews(symbol: string, options: SymbolNewsOptions = {}): Promise<SymbolNews> {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const pastHours = options.pastHours ?? 12;
  const aheadHours = options.aheadHours ?? 120;
  const minImpact = options.minImpact ?? 2;

  const calendar = await newsService().getCalendar(calendarWindow(pastHours, aheadHours, now));
  const relevant = filterRelevant(calendar.events, symbol, minImpact);

  // The risk verdict is deliberately computed on the *unfiltered* list at the
  // same minimum impact, so a holiday filter or a row cap can never turn a
  // blackout into an all-clear.
  const risk = assessNewsRisk({
    events: calendar.events,
    symbol,
    now,
    haveData: calendar.provider !== "none",
  });

  return {
    symbol,
    events: relevant.slice(0, options.limit ?? 40),
    risk,
    currencies: relevantCurrencies(symbol),
    provider: calendar.provider,
    demo: calendar.demo,
    ...(calendar.note ? { note: calendar.note } : {}),
    fetchedAt: calendar.fetchedAt,
  };
}

/* -------------------------------------------------------------------------- */
/*  "What did this market do last time?"                                      */
/* -------------------------------------------------------------------------- */

/** 15m bars, two of them: the release bar and the one after it. */
const REACTION_TIMEFRAME: Timeframe = "15m";
const REACTION_TIMEFRAME_SECONDS = 900;
const REACTION_WINDOW_CANDLES = 2;

/**
 * How many past releases we fetch price for. Each one is a separate request to
 * the data provider, and the free Twelve Data tier allows eight per minute, so
 * this is a budget, not a preference. Ten releases of a monthly event is most
 * of a year — long enough to be representative, short enough to still describe
 * the current regime.
 */
const MAX_RELEASES_PRICED = 10;
/** Parallel slice requests. Low enough not to trip a free-tier rate limit. */
const SLICE_CONCURRENCY = 4;

export interface EventReaction {
  symbol: string;
  event: {
    eventId: number;
    title: string;
    currency: string;
    impact: NewsImpact;
    description: string;
    source: string;
  };
  study: ReactionStudy;
  better: ReactionReading;
  worse: ReactionReading;
  /** How many past releases the source had, before pricing was attempted. */
  releasesKnown: number;
  /** Price quality behind the measurement — DEMO must never read as measured. */
  dataStatus: DataStatus | null;
}

interface CacheEntry {
  value: EventReaction | null;
  expiresAt: number;
}

/**
 * Past releases do not change, and neither do the candles around them, so this
 * is cached for hours rather than minutes. The only thing that moves is the
 * newest release, and that arrives with the next calendar fetch.
 */
const reactionCache = new Map<string, CacheEntry>();
const REACTION_TTL_SECONDS = 6 * 3600;

/** Fetch just the bars around one release instead of a year of history. */
async function sliceAround(symbol: string, time: number): Promise<{ candles: Candle[]; status: DataStatus } | null> {
  try {
    const response = await marketService().getCandles({
      symbol,
      timeframe: REACTION_TIMEFRAME,
      // One bar before the release for the base price, the window, and a
      // little slack so a provider's bar alignment cannot clip the end.
      limit: REACTION_WINDOW_CANDLES + 4,
      startTime: time - 2 * REACTION_TIMEFRAME_SECONDS,
      endTime: time + (REACTION_WINDOW_CANDLES + 2) * REACTION_TIMEFRAME_SECONDS,
    });
    return { candles: response.candles, status: response.status };
  } catch {
    // A missing slice is a release we cannot measure. The study counts it as
    // skipped; it is never filled in with a neighbouring bar.
    return null;
  }
}

async function pricedCandles(
  symbol: string,
  times: number[],
): Promise<{ candles: Candle[]; status: DataStatus | null }> {
  const merged = new Map<number, Candle>();
  let status: DataStatus | null = null;

  for (let start = 0; start < times.length; start += SLICE_CONCURRENCY) {
    const batch = times.slice(start, start + SLICE_CONCURRENCY);
    const slices = await Promise.all(batch.map((time) => sliceAround(symbol, time)));
    for (const slice of slices) {
      if (!slice) continue;
      // The worst quality seen wins, same rule the MTF chain uses: a study is
      // only as trustworthy as its weakest input.
      if (!status || (status.quality === "LIVE" && slice.status.quality !== "LIVE")) {
        status = slice.status;
      }
      for (const candle of slice.candles) merged.set(candle.time, candle);
    }
  }

  const candles = [...merged.values()].sort((a, b) => a.time - b.time);
  return { candles, status };
}

export async function eventReaction(
  symbol: string,
  eventId: number,
  path?: string,
): Promise<EventReaction | null> {
  const key = `${symbol}:${eventId}:${path ?? ""}`;
  const now = Math.floor(Date.now() / 1000);
  const cached = reactionCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  const history: NewsEventHistory | null = await newsService().getHistory(eventId, path);
  const remember = (value: EventReaction | null): EventReaction | null => {
    reactionCache.set(key, { value, expiresAt: now + REACTION_TTL_SECONDS });
    return value;
  };
  if (!history) return remember(null);

  // Newest first from the provider; price the most recent ones, because they
  // describe the regime the trader is actually in.
  const occurrences = history.occurrences.slice(0, MAX_RELEASES_PRICED);
  const { candles, status } = await pricedCandles(
    symbol,
    occurrences.map((o) => o.time),
  );

  const study = studyReactions({
    symbol,
    eventId,
    occurrences,
    candles,
    timeframeSeconds: REACTION_TIMEFRAME_SECONDS,
    windowCandles: REACTION_WINDOW_CANDLES,
  });

  return remember({
    symbol,
    event: {
      eventId: history.eventId,
      title: history.title,
      currency: history.currency,
      impact: history.impact,
      description: history.description,
      source: history.source,
    },
    study,
    better: readTendency(study.better),
    worse: readTendency(study.worse),
    releasesKnown: history.occurrences.length,
    dataStatus: status,
  });
}
