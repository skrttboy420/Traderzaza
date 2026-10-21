import { getAsset } from "@atc/market-data";
import type { DataStatus, ScannerState, Timeframe } from "@atc/types";
import type { BacktestReport } from "@atc/engine";

/**
 * The wire shape of `GET /api/backtest`, plus the two judgements the screen is
 * most likely to get wrong.
 *
 * Split out of the route for the same reason `scan-cost.ts` was: the route
 * imports `next/headers` and the market-data service, the panel that renders
 * this cannot be mounted in a unit test, and both decisions below are the kind
 * that read correctly in review and mislead on screen.
 */

/**
 * Entry timeframes the backtest will run on.
 *
 * This list is a *cost* decision before it is a UI one. The candle cache keys
 * on `{symbol, timeframe, limit}`, so a timeframe outside the chain the scan
 * already loads is a fresh metered fetch on every press — on gold, the one
 * metered market, that is credits spent to answer a question about the past.
 * Every entry here is in `MTF_CHAIN`, so a backtest asks for exactly the series
 * a scan asks for: free while the page's own candles are still warm, and no
 * dearer than refreshing that market once the TTL has lapsed. Never a second,
 * parallel set of cache entries quietly doubling the bill.
 *
 * 4H is deliberately absent even though the chain loads it. At 400 bars a 4H
 * run spans months but settles almost nothing: the 60-bar horizon alone is ten
 * days, so the tail of the sample never closes and the report would be mostly
 * `windowClosed`. These three are also exactly the stepping timeframes the
 * replay trainer offers, so the two halves of the training screen speak about
 * the same frames.
 */
export const BACKTEST_TIMEFRAMES: Timeframe[] = ["5m", "15m", "1h"];

export const DEFAULT_BACKTEST_TIMEFRAME: Timeframe = "15m";

/**
 * Which signals to settle — two different questions, both worth asking.
 *
 *  - `graded` takes every setup the engine attached a letter to. This is the
 *    question the module was built for: if an A does not out-earn a C, the
 *    grade is decoration. The scanner state is a separate filter from the
 *    grade, so folding it in here would measure the two at once and tell us
 *    which of them failed.
 *  - `entry` takes only ENTRY_NOW, the one state the app presents as act-on-it-
 *    now. This is the narrower question "were the calls I was actually shown
 *    any good".
 *
 * Measured on four days of gold, `entry` settles nothing at all — the engine
 * never reached ENTRY_NOW once in 279 bars — while `graded` settles seventeen
 * trades. That gap is the reason both modes exist rather than just the strict
 * one: a lone `entry` run would report an empty table on most windows, and an
 * empty table is the easiest thing in this app to misread as a quiet market.
 */
export const BACKTEST_MODES = ["graded", "entry"] as const;

export type BacktestMode = (typeof BACKTEST_MODES)[number];

export const DEFAULT_BACKTEST_MODE: BacktestMode = "graded";

/**
 * NO_TRADE is excluded from both modes, and not as a tidiness measure. It is
 * the engine saying "stay out"; settling it would be scoring the system on
 * trades it told you not to take, and the resulting R would belong to no
 * decision anyone made.
 */
export function modeStates(mode: BacktestMode): ScannerState[] {
  return mode === "entry"
    ? ["ENTRY_NOW"]
    : ["ENTRY_NOW", "WAIT_CONFIRMATION", "LIMIT_ZONE", "WATCHLIST"];
}

export interface BacktestRequest {
  symbol: string;
  timeframe: Timeframe;
  mode: BacktestMode;
}

export interface BacktestResponse {
  /**
   * Echoed back so the panel labels the table with what the server actually
   * ran, not with whatever the controls say by the time the reply lands. The
   * run takes seconds, which is long enough for the user to change the mode
   * mid-flight and read one mode's numbers under the other's heading.
   */
  request: BacktestRequest;
  report: BacktestReport;
  /** Bars between analyses. Reported because it bounds what the run could see. */
  stride: number;
  /** Bars behind the report, per timeframe, so "thin" can be explained. */
  bars: Partial<Record<Timeframe, number>>;
  status: DataStatus;
  /**
   * Credits this press actually spent, measured rather than estimated. Null
   * when the deployment has no metered feed to spend from.
   */
  credits: number | null;
  /** Wall-clock cost of the run. The engine is re-run once per bar. */
  ranMs: number;
}

export type ParsedBacktestRequest =
  | { ok: true; request: BacktestRequest }
  | { ok: false; error: string };

/**
 * Validate what the client asked for before any of it reaches the engine.
 *
 * The failure this exists to prevent is not a crash — it is a lie. `backtest()`
 * reads `candles[entryTimeframe]`, and for a timeframe the server never loaded
 * that is `undefined`, which becomes an empty series, which becomes a report of
 * zero analyses and zero trades. On screen that is indistinguishable from "the
 * engine looked and found nothing worth trading", so a typo in a query string
 * would read as a quiet market. Refusing outright is the only answer that
 * cannot be mistaken for a result.
 */
export function parseBacktestRequest(params: {
  symbol?: string | null;
  timeframe?: string | null;
  mode?: string | null;
}): ParsedBacktestRequest {
  const symbol = (params.symbol ?? "").trim().toUpperCase();
  if (!symbol) return { ok: false, error: "symbol is required" };
  if (!getAsset(symbol)) return { ok: false, error: `unknown symbol: ${symbol}` };

  const raw = (params.timeframe ?? "").trim();
  const timeframe = (raw || DEFAULT_BACKTEST_TIMEFRAME) as Timeframe;
  if (!BACKTEST_TIMEFRAMES.includes(timeframe)) {
    return { ok: false, error: `backtest does not run on ${timeframe}` };
  }

  const rawMode = (params.mode ?? "").trim();
  const mode = (rawMode || DEFAULT_BACKTEST_MODE) as BacktestMode;
  if (!BACKTEST_MODES.includes(mode)) {
    return { ok: false, error: `unknown backtest mode: ${mode}` };
  }

  return { ok: true, request: { symbol, timeframe, mode } };
}

/**
 * Five outcomes, because collapsing them is how a backtest starts lying.
 *
 *  - `noRun`      the series was too short to analyse a single bar
 *  - `noSignals`  the engine ran and never called an entry
 *  - `thin`       trades exist, but fewer than two grades reached the sample
 *                 size at which expectancy means anything
 *  - `holds`      average R falls as the grade falls, which is the claim the
 *                 grade makes
 *  - `inverted`   it does not, and the grade is decoration
 *
 * `thin` is the one that matters. The engine reports an unanswerable question
 * as `gradeOrderHolds === null`, and `null` is falsy, so the obvious rendering
 * — a tick when true, a cross otherwise — turns "we cannot say yet" into "the
 * grading is broken", while `?? true` turns it into a pass the data does not
 * support. On a few hundred bars `null` is the *usual* answer, so whichever way
 * it is collapsed becomes the number the user reads most often.
 *
 * `noSignals` is separated from `noRun` for the same reason: an engine that
 * declined to trade for four days is working as designed, and must not look
 * like a backtest that failed to start.
 */
export type BacktestVerdict = "noRun" | "noSignals" | "thin" | "holds" | "inverted";

export function backtestVerdict(report: BacktestReport): BacktestVerdict {
  if (report.analysed === 0) return "noRun";
  if (report.trades.length === 0) return "noSignals";
  if (report.gradeOrderHolds === null) return "thin";
  return report.gradeOrderHolds ? "holds" : "inverted";
}

/**
 * Whether the headline expectancy is worth reading as a number at all.
 *
 * Same honesty problem one level down: `overall.expectancyR` is defined for a
 * single trade, and a single trade's R printed to two decimals looks exactly
 * like a measured edge. The panel uses this to decide whether to show the
 * figure or the sample size instead.
 */
export function hasUsableSample(report: BacktestReport, minimum = 20): boolean {
  return report.overall.trades >= minimum;
}
