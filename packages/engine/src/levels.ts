import type { Candle, Phrase, SupplyDemandZone } from "@atc/types";
import { atrAt, clamp } from "./indicators";
import { p } from "./phrases";
import { zoneDistanceAtr } from "./zones";

/**
 * Higher-timeframe key levels.
 *
 * Everything else in the engine looks at one symbol on one chart and asks what
 * the candles are doing. This module asks a different question: which prices do
 * *other people* already have orders sitting at? Yesterday's high, last week's
 * range, the weekly open, the round number — these are not derived from the
 * structure the engine reads, they are derived from where the rest of the
 * market is looking. A demand zone that happens to sit on last week's low is a
 * materially different proposition from the same zone floating in open space,
 * and until now the engine could not tell those two apart.
 *
 * Two deliberate constraints:
 *
 *  1. **No extra data.** Everything here is aggregated from the 4H series the
 *     scanner already fetched. A `1d` request would be one more TwelveData
 *     credit per symbol per scan, and 400 4H bars is already 66 days — ample
 *     for a previous day, a previous week and a daily ATR. Levels that cost
 *     nothing get used; levels that cost a credit get switched off.
 *
 *  2. **Never the in-progress period.** `detectKeyLevels` treats the final day
 *     and the final week in the series as still being written, and reads
 *     "previous" as the one before that. A day that has in fact already closed
 *     is therefore ignored for one extra session. That is the right way to be
 *     wrong: the alternative — guessing that the last group is complete — hands
 *     a backtest a high that had not printed yet.
 */

const DAY_SECONDS = 86400;
const WEEK_SECONDS = 604800;
/**
 * 1970-01-01 was a Thursday, so the unshifted week boundary falls on a
 * Thursday. Adding four days moves it to Monday 1970-01-05, which is what the
 * FX week actually opens on.
 */
const WEEK_EPOCH_OFFSET = 345600;

export type KeyLevelKind =
  | "prevDayHigh"
  | "prevDayLow"
  | "prevDayClose"
  | "prevWeekHigh"
  | "prevWeekLow"
  | "weekOpen"
  | "round";

export interface KeyLevel {
  kind: KeyLevelKind;
  price: number;
  /**
   * How much attention this kind of level commands, 0-1. A previous day's high
   * is a hard reference every desk marks; a round number is a soft one that
   * only matters because it is memorable.
   */
  weight: number;
  /**
   * When the level was sealed — the close of the period that produced it.
   * Round numbers are timeless and carry 0.
   */
  sealedAt: number;
}

const KIND_WEIGHT: Record<KeyLevelKind, number> = {
  prevDayHigh: 1,
  prevDayLow: 1,
  prevWeekHigh: 1,
  prevWeekLow: 1,
  weekOpen: 0.8,
  prevDayClose: 0.7,
  round: 0.6,
};

export const KEY_LEVEL_KINDS: KeyLevelKind[] = [
  "prevDayHigh",
  "prevDayLow",
  "prevDayClose",
  "prevWeekHigh",
  "prevWeekLow",
  "weekOpen",
  "round",
];

export const levelPhrase = (kind: KeyLevelKind): Phrase => ({ key: `label.level.${kind}` });

/** UTC calendar day a timestamp falls in. */
export function dayIndex(time: number): number {
  return Math.floor(time / DAY_SECONDS);
}

/** Monday-start UTC week a timestamp falls in. */
export function weekIndex(time: number): number {
  return Math.floor((time - WEEK_EPOCH_OFFSET) / WEEK_SECONDS);
}

export interface Period {
  index: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Open time of the first candle in the period. */
  start: number;
  /** Open time of the last candle in the period. */
  end: number;
}

/**
 * Roll a candle series up into calendar periods.
 *
 * Gaps are fine — a weekend with no candles simply produces no period, it does
 * not produce an empty one. Periods come back in chronological order.
 */
export function groupPeriods(candles: Candle[], indexOf: (time: number) => number): Period[] {
  const out: Period[] = [];
  let current: Period | null = null;

  for (const candle of candles) {
    const index = indexOf(candle.time);
    if (!current || current.index !== index) {
      current = {
        index,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        start: candle.time,
        end: candle.time,
      };
      out.push(current);
      continue;
    }
    current.high = Math.max(current.high, candle.high);
    current.low = Math.min(current.low, candle.low);
    current.close = candle.close;
    current.end = candle.time;
  }

  return out;
}

/**
 * The spacing between round numbers that a trader on this instrument would
 * actually notice.
 *
 * It has to scale with the instrument, and the only scale-free quantity the
 * engine has is volatility: a level worth marking should be roughly a day's
 * range apart, so price reaches one every day or two rather than every hour
 * (noise) or every quarter (irrelevant). Candidates are the 1 / 2.5 / 5 / 10
 * ladder at the ATR's own order of magnitude, and the smallest rung that is at
 * least one ATR wins — gold at 30/day gets 50, EURUSD at 0.007 gets 0.01,
 * USDJPY at 0.9 gets 1.00, BTC at 1800 gets 2500.
 */
export function roundStep(atrValue: number): number {
  if (!Number.isFinite(atrValue) || atrValue <= 0) return 0;
  const magnitude = Math.pow(10, Math.floor(Math.log10(atrValue)));
  for (const rung of [1, 2.5, 5, 10]) {
    const step = rung * magnitude;
    if (step >= atrValue) return Number(step.toPrecision(12));
  }
  return Number((10 * magnitude).toPrecision(12));
}

export interface KeyLevelOptions {
  /** Current price. Round numbers are generated around it. */
  price: number;
  /** Round numbers emitted on each side of price. */
  roundCount?: number;
}

/**
 * Key levels from a higher-timeframe series.
 *
 * `htfCandles` is expected to be the 4H chain the scanner already loaded. Pass
 * only closed candles — in the backtest that is what `closedFrames` hands over,
 * and live the provider only returns closed bars anyway.
 */
export function detectKeyLevels(htfCandles: Candle[], options: KeyLevelOptions): KeyLevel[] {
  const out: KeyLevel[] = [];
  const add = (kind: KeyLevelKind, price: number, sealedAt: number): void => {
    if (!Number.isFinite(price) || price <= 0) return;
    out.push({ kind, price: Number(price.toFixed(8)), weight: KIND_WEIGHT[kind], sealedAt });
  };

  const days = groupPeriods(htfCandles, dayIndex);
  const weeks = groupPeriods(htfCandles, weekIndex);

  // The last group is still being written, so "previous" is the one before it.
  const prevDay = days[days.length - 2];
  if (prevDay) {
    add("prevDayHigh", prevDay.high, prevDay.end);
    add("prevDayLow", prevDay.low, prevDay.end);
    add("prevDayClose", prevDay.close, prevDay.end);
  }

  const prevWeek = weeks[weeks.length - 2];
  if (prevWeek) {
    add("prevWeekHigh", prevWeek.high, prevWeek.end);
    add("prevWeekLow", prevWeek.low, prevWeek.end);
  }

  // The current week's open is fixed the moment the week starts, so unlike its
  // high and low it is knowable now without looking forward.
  const thisWeek = weeks[weeks.length - 1];
  if (thisWeek) add("weekOpen", thisWeek.open, thisWeek.start);

  // Daily ATR from complete days only — including the partial one in progress
  // would understate the range and tighten the round-number ladder.
  const completeDays = days.slice(0, -1);
  const step = roundStep(dailyAtr(completeDays));
  if (step > 0 && options.price > 0) {
    const count = options.roundCount ?? 2;
    const base = Math.floor(options.price / step);
    for (let k = -count + 1; k <= count; k += 1) {
      const price = Number(((base + k) * step).toPrecision(12));
      if (price > 0) add("round", price, 0);
    }
  }

  return out;
}

/** Wilder ATR over daily aggregates, in price units. */
export function dailyAtr(days: Period[]): number {
  if (days.length === 0) return 0;
  const asCandles: Candle[] = days.map((d) => ({
    time: d.start,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
    volume: 0,
  }));
  return atrAt(asCandles, asCandles.length - 1);
}

export interface ZoneConfluence {
  /** 0-100. How much outside attention already sits on this zone. */
  score: number;
  /** The levels that reinforce it, strongest contribution first. */
  levels: KeyLevel[];
  facts: Phrase[];
}

/**
 * Proximity credit, in ATR multiples from the nearest zone edge.
 *
 * A level inside the zone is the whole point. Beyond that the credit decays
 * fast, because a "confluence" a full ATR away is just two things on the same
 * chart.
 */
function proximityScore(distanceAtr: number): number {
  if (distanceAtr <= 0) return 100;
  if (distanceAtr <= 0.25) return 75;
  if (distanceAtr <= 0.5) return 50;
  if (distanceAtr <= 1) return 25;
  return 0;
}

/**
 * How strongly outside reference levels back this zone.
 *
 * The strongest single level sets the score. Each additional level in range
 * adds a flat 10 — a second independent reference is real extra evidence, but
 * nothing like as much as the first, and stacking them multiplicatively would
 * let a cluster of round numbers outrank a previous week's low.
 */
export function zoneConfluence(
  zone: SupplyDemandZone,
  levels: KeyLevel[],
  atrValue: number,
): ZoneConfluence {
  const scored = levels
    .map((level) => {
      const distance = zoneDistanceAtr(zone, level.price, atrValue);
      return { level, distance, contribution: proximityScore(distance) * level.weight };
    })
    .filter((entry) => entry.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution);

  const best = scored[0];
  if (!best) {
    return { score: 0, levels: [], facts: [p("level.fact.none")] };
  }

  const score = clamp(Math.round(best.contribution + (scored.length - 1) * 10), 0, 100);
  return {
    score,
    levels: scored.map((entry) => entry.level),
    facts: scored.map((entry) =>
      p("level.fact.near", {
        level: levelPhrase(entry.level.kind),
        price: entry.level.price,
        distance: entry.distance,
      }),
    ),
  };
}

/**
 * Key levels sitting between a planned entry and its first target.
 *
 * This is the opposite use of the same information: a level the trade has to
 * pass *through* is not support for the idea, it is the place the move is most
 * likely to stall. A 3R target with yesterday's high at 1R is really a 1R
 * target with an argument attached.
 *
 * Levels exactly at either endpoint are excluded — the entry sitting on a level
 * is confluence, already counted, and a target sitting on one is the target
 * being chosen sensibly.
 */
export function levelsInPath(entry: number, target: number, levels: KeyLevel[]): KeyLevel[] {
  const low = Math.min(entry, target);
  const high = Math.max(entry, target);
  if (!(high > low)) return [];
  return levels
    .filter((level) => level.price > low && level.price < high)
    .sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry));
}
