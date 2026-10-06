import type { Candle } from "@atc/types";

import type { NewsOccurrence, NewsSurprise } from "./types";

/**
 * "Last time this printed green, gold fell" — measured, not remembered.
 *
 * This file answers the user's actual question about news with arithmetic
 * instead of opinion: take every past release of a recurring event, look at
 * what THIS market did in the window straight after it, and report the
 * distribution. No language model touches these numbers.
 *
 * Everything here is a pure function of (occurrences, candles). There is no
 * network call, so the study is reproducible and testable.
 */

/** Below this many samples in a group we refuse to generalise from it. */
export const MIN_SAMPLES = 3;

export interface ReactionSample {
  occurrenceId: number;
  /** Release time, unix seconds. */
  time: number;
  surprise: NewsSurprise;
  /** Close of the candle before the release — the price news arrived at. */
  basePrice: number;
  /** Close at the end of the measurement window. */
  exitPrice: number;
  movePrice: number;
  movePercent: number;
  /** High-to-low of the window as a percent: how violent, regardless of direction. */
  rangePercent: number;
  /** Furthest the window travelled up and down from base, in percent. */
  upPercent: number;
  downPercent: number;
}

export interface ReactionGroup {
  surprise: NewsSurprise;
  count: number;
  /** Median, not mean: one 2008-style outlier should not define the picture. */
  medianMovePercent: number;
  medianRangePercent: number;
  upCount: number;
  downCount: number;
  /** True when count >= MIN_SAMPLES. The UI must not generalise when false. */
  enough: boolean;
}

export interface ReactionStudy {
  symbol: string;
  eventId: number;
  /** Minutes measured after the release. Derived from the candle timeframe. */
  windowMinutes: number;
  /** Every usable past release, newest first. */
  samples: ReactionSample[];
  better: ReactionGroup;
  worse: ReactionGroup;
  /** How many past releases we had but could not measure (candles missing). */
  skipped: number;
  /**
   * True only when at least one group has enough samples. When false the UI
   * must report "not enough history", never an average of two data points.
   */
  usable: boolean;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function group(samples: ReactionSample[], surprise: NewsSurprise): ReactionGroup {
  const rows = samples.filter((s) => s.surprise === surprise);
  return {
    surprise,
    count: rows.length,
    medianMovePercent: median(rows.map((r) => r.movePercent)),
    medianRangePercent: median(rows.map((r) => r.rangePercent)),
    upCount: rows.filter((r) => r.movePrice > 0).length,
    downCount: rows.filter((r) => r.movePrice < 0).length,
    enough: rows.length >= MIN_SAMPLES,
  };
}

export interface ReactionInput {
  symbol: string;
  eventId: number;
  /** Past releases. Order does not matter; the result is sorted newest first. */
  occurrences: NewsOccurrence[];
  /** Ascending, uniform timeframe, no gaps assumed beyond market closes. */
  candles: Candle[];
  /** Seconds per candle in `candles`. */
  timeframeSeconds: number;
  /** How many candles after the release to measure. 1 = the release candle. */
  windowCandles?: number;
}

/**
 * Locate the candle that contains `time`.
 *
 * Returns -1 when the release falls in a gap (weekend, market closed, provider
 * hole). A release we cannot locate is skipped and counted, never approximated
 * to the nearest candle — that would silently measure the wrong hour.
 */
function candleIndexAt(candles: Candle[], time: number, timeframeSeconds: number): number {
  let low = 0;
  let high = candles.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const candle = candles[mid];
    if (!candle) break;
    if (time < candle.time) {
      high = mid - 1;
    } else if (time >= candle.time + timeframeSeconds) {
      low = mid + 1;
    } else {
      return mid;
    }
  }
  return -1;
}

export function studyReactions(input: ReactionInput): ReactionStudy {
  const { symbol, eventId, candles, timeframeSeconds } = input;
  const windowCandles = Math.max(1, input.windowCandles ?? 1);
  const samples: ReactionSample[] = [];
  let skipped = 0;

  for (const occurrence of input.occurrences) {
    if (occurrence.surprise === "inline") {
      // An in-line print is not a surprise, so it tells us nothing about how
      // the market reacts to one. Counted as skipped so the UI can say so.
      skipped += 1;
      continue;
    }

    const index = candleIndexAt(candles, occurrence.time, timeframeSeconds);
    if (index <= 0 || index + windowCandles - 1 >= candles.length) {
      skipped += 1;
      continue;
    }

    const before = candles[index - 1];
    const window = candles.slice(index, index + windowCandles);
    const exit = window[window.length - 1];
    if (!before || !exit || !Number.isFinite(before.close) || before.close === 0) {
      skipped += 1;
      continue;
    }

    const basePrice = before.close;
    let high = -Infinity;
    let low = Infinity;
    for (const bar of window) {
      if (bar.high > high) high = bar.high;
      if (bar.low < low) low = bar.low;
    }
    if (!Number.isFinite(high) || !Number.isFinite(low)) {
      skipped += 1;
      continue;
    }

    const movePrice = exit.close - basePrice;
    samples.push({
      occurrenceId: occurrence.occurrenceId,
      time: occurrence.time,
      surprise: occurrence.surprise,
      basePrice,
      exitPrice: exit.close,
      movePrice,
      movePercent: (movePrice / basePrice) * 100,
      rangePercent: ((high - low) / basePrice) * 100,
      upPercent: ((high - basePrice) / basePrice) * 100,
      downPercent: ((low - basePrice) / basePrice) * 100,
    });
  }

  samples.sort((a, b) => b.time - a.time);
  const better = group(samples, "better");
  const worse = group(samples, "worse");

  return {
    symbol,
    eventId,
    windowMinutes: Math.round((timeframeSeconds * windowCandles) / 60),
    samples,
    better,
    worse,
    skipped,
    usable: better.enough || worse.enough,
  };
}

/* -------------------------------------------------------------------------- */
/*  Turning the study into something a trader can read                        */
/* -------------------------------------------------------------------------- */

export type ReactionTendency = "up" | "down" | "mixed" | "unknown";

export interface ReactionReading {
  tendency: ReactionTendency;
  /** The group this reading describes. */
  surprise: NewsSurprise;
  count: number;
  medianMovePercent: number;
  medianRangePercent: number;
  /** How lopsided the direction was, 0-1. 0.75 = 3 of 4 went the same way. */
  consistency: number;
}

/**
 * A tendency is only called when the group has enough samples AND at least 70%
 * of them went the same way. Anything else is reported as "mixed", which is an
 * honest answer and a useful one: it means the event moves this market without
 * a reliable direction, so trade the reaction, not the forecast.
 */
export function readTendency(group: ReactionGroup): ReactionReading {
  const directional = group.upCount + group.downCount;
  const consistency = directional === 0 ? 0 : Math.max(group.upCount, group.downCount) / directional;

  let tendency: ReactionTendency = "unknown";
  if (group.enough && directional > 0) {
    if (consistency < 0.7) tendency = "mixed";
    else tendency = group.upCount > group.downCount ? "up" : "down";
  }

  return {
    tendency,
    surprise: group.surprise,
    count: group.count,
    medianMovePercent: group.medianMovePercent,
    medianRangePercent: group.medianRangePercent,
    consistency,
  };
}
