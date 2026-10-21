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

/**
 * How deep the archive is filled, in calendar days.
 *
 * Four months, because that is what makes the per-grade verdict answerable at
 * all. Measured on 120 days of 15-minute BTC: 386 settled trades spread
 * B:69 C:196 D:118, three grades past the 20-trade floor at which expectancy
 * stops being able to flip its own sign. The shipped 400-bar window settles
 * seventeen trades across all grades, so it can only ever report `thin`.
 *
 * It is also affordable exactly once. On the metered feed the whole chain at
 * this depth is about ten credits of the daily 800 — paid on the first press
 * and never again, because the bars are written down.
 */
export const BACKTEST_DEPTH_DAYS = 120;

/**
 * Analyses a single run may perform.
 *
 * This is a *deadline* budget, not a quality one. `analyze` is re-run from
 * scratch at every step over four timeframes of indicators, and it measures at
 * roughly 36ms a call — so the run length is set by how many times it is
 * called, and nothing else. The serverless deadline is 60s (see `maxDuration`
 * on the route), and a run cut off at the deadline is not a slower answer, it
 * is a network error on screen.
 *
 * 700 measured at 33s end to end on a four-month archive, including the read.
 * The first value tried was 900, which measured 41s — inside the deadline but
 * only just, and the margin has to absorb a cold instance, a slower database
 * round trip and a market with more signals than the one measured. A run that
 * overruns does not return a smaller answer, it returns a network error.
 */
export const MAX_ANALYSES = 700;

/**
 * Bars to step between analyses, chosen so a run of any depth still finishes.
 *
 * A fixed stride cannot work once history stops being fixed: stride 2 over
 * four days is 140 analyses and five seconds, and stride 2 over four months is
 * 5,700 analyses and 208 seconds — the same constant, one of which is a
 * timeout. So the stride is derived from the series instead.
 *
 * Widening it costs far less than it looks like it should, because the sample
 * is not bounded by how often the engine is asked. One-position-at-a-time and
 * once-per-zone collapse long runs of adjacent signals into a single trade
 * regardless, so a denser walk mostly re-reads zones already being traded.
 * Measured across the same 120 days of 15-minute BTC:
 *
 *   stride  2  208s  386 trades
 *   stride  4  103s  355 trades   (half the time, 8% of the trades)
 *   stride  8   56s  291 trades
 *   stride 12   33s  249 trades   (a sixth of the time, a third of the trades)
 *
 * Trading 249 trades over four months against 386 is a good deal; trading 386
 * against a timeout is not. And either beats seventeen trades over four days,
 * which is the sample this replaces.
 *
 * The floor of 2 keeps today's shallow runs exactly as they ship: 400 bars
 * never reaches the cap, so the live fallback path is unchanged.
 *
 * What a wide stride *does* cost is transient states, and `entry` mode is
 * made of them. WATCHLIST and LIMIT_ZONE persist for hours, so a three-hour
 * step still lands inside them; ENTRY_NOW is momentary by construction, and a
 * step that wide walks over most of the moments it existed. Measured on four
 * months of 15-minute BTC, `entry` settles a single trade. That is a sampling
 * artefact as much as a fact about the market, and it is why the response
 * reports `stride` rather than treating it as an implementation detail.
 */
export function backtestStride(entryBars: number): number {
  return Math.max(2, Math.ceil(entryBars / MAX_ANALYSES));
}

/** Where the bars a run was graded on came from. */
export type BacktestSource = "archive" | "live";

export interface BacktestCoverage {
  /** Bars stored for the entry timeframe. */
  bars: number;
  /** Calendar days between the oldest and newest stored bar. */
  days: number;
  /** False when this deployment has no database to store history in. */
  configured: boolean;
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
   * Whether the run read stored history or the live 400-bar window.
   *
   * On screen this is the difference between "the grading does not hold" and
   * "we cannot say yet", so it must never be inferred from the trade count.
   * A `live` run is four days deep and will almost always report `thin`;
   * presenting that identically to a four-month `archive` run would let a
   * missing database read as a verdict about the strategy.
   */
  source: BacktestSource;
  /** What is stored for this series, so the panel can offer to deepen it. */
  coverage: BacktestCoverage;
  /**
   * Credits this press actually spent, measured rather than estimated. Null
   * when the deployment has no metered feed to spend from.
   */
  credits: number | null;
  /** Wall-clock cost of the run. The engine is re-run once per bar. */
  ranMs: number;
}

/**
 * One timeframe's result from a backfill press.
 *
 * Reported per frame rather than as a single success flag because the frames
 * fail differently and independently: four months of 4H is one page, four
 * months of 5M is thirty, and a run where 5M alone hit the page budget is a
 * real outcome the user can fix by pressing again. One flag would hide it.
 */
export interface BackfillFrame {
  timeframe: Timeframe;
  /** Upstream calls spent. On the metered feed this is the bill. */
  pages: number;
  /** Bars sent to the database. */
  written: number;
  /** Bars stored for this frame afterwards. */
  stored: number;
  /**
   * Why the walk ended. Four of these come from `BackfillStop` in
   * @atc/market-data; `deadline` is added by the route, which stops the whole
   * press before the serverless platform would and marks the frames it never
   * got to. They are kept distinct because only two are problems: `target` is
   * done, `deadline` and `pageLimit` mean press again, `providerWall` is the
   * real end of the feed's history, and `error` is the only failure.
   */
  stopped: "target" | "providerWall" | "pageLimit" | "deadline" | "error";
  reason?: string;
}

/**
 * Whether pressing again would get more history.
 *
 * The panel needs this to decide between "filled" and "press again", and the
 * distinction is not cosmetic: `providerWall` means the feed has no more bars
 * and pressing again spends credits for nothing, while `pageLimit` and
 * `deadline` mean the run stopped itself and the next press resumes. Treating
 * them alike would either hide real missing history or invite the user to buy
 * the same wall over and over.
 */
export function backfillIncomplete(frames: BackfillFrame[]): boolean {
  return frames.some((f) => f.stopped === "pageLimit" || f.stopped === "deadline");
}

export interface BackfillResponse {
  request: BacktestRequest;
  frames: BackfillFrame[];
  /** Coverage of the entry timeframe once the run finished. */
  coverage: BacktestCoverage;
  /** Credits this press actually spent. Null without a metered feed. */
  credits: number | null;
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
