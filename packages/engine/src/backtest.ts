import type {
  Asset,
  Candle,
  DataStatus,
  EntryPlan,
  ScannerState,
  Setup,
  SetupQuality,
  Timeframe,
  Trade,
} from "@atc/types";
import { TIMEFRAME_SECONDS } from "@atc/types";
import { resolvePracticeCall, type PracticeExitKind } from "./replay";
import { EXPECTANCY_MIN_SAMPLE, summarizePerformance, type PerformanceSummary } from "./risk";
import { analyze } from "./setups";

/**
 * Walk the engine forward through history and settle what it said.
 *
 * Everything else in this package answers "what does the chart look like right
 * now". Nothing answered "and was that read worth acting on", which means every
 * threshold in `scoring.ts` — the 0.25 on zone quality, the 80 that makes a
 * grade an A — has so far been an opinion. A weight nobody can measure is a
 * weight nobody can defend, and the honest consequence is that the system could
 * not tell the difference between being right and being confident.
 *
 * This module exists to end that. It replays the candle series one bar at a
 * time, re-runs `analyze` on the bars that had genuinely closed by that
 * instant, takes the signals at face value, and settles each one against what
 * the market actually did next. The output is per-grade expectancy: if grade A
 * does not earn more than grade C, the grade is decoration and the scoring
 * needs rethinking rather than defending.
 *
 * It is not a trading simulator. There are no spreads, no commission, no
 * slippage and no partial fills, so the R figures are an upper bound on what
 * the same decisions would have earned in a real account. The *ordering*
 * between grades is the part worth trusting; the absolute numbers are not.
 */

/* -------------------------------------------------------------------------- */
/*  Lookahead control                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The candles of one timeframe that had finished printing at `clock`.
 *
 * The naive filter — `c.time <= clock` — is the single most expensive mistake a
 * backtest can make, and it is silent. A 4H candle carries its *open* time, so
 * at 13:00 a bar stamped 12:00 passes that test while still containing the
 * highs and lows of 13:00 through 16:00. The engine then reads a completed
 * structure event that had not happened yet, grades the setup on it, and the
 * report comes back flattering and worthless. `ReplayController.visible()` has
 * exactly this shape, which is tolerable for a training screen the trader is
 * stepping by hand and not tolerable here.
 *
 * Candles arrive oldest-first, so the first bar that has not closed ends the
 * usable prefix.
 */
export function closedCandles(candles: Candle[], timeframe: Timeframe, clock: number): Candle[] {
  const span = TIMEFRAME_SECONDS[timeframe];
  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i];
    if (!candle) continue;
    if (candle.time + span > clock) return candles.slice(0, i);
  }
  return candles.slice();
}

/**
 * Every timeframe truncated to the bars that had closed at `clock`, keeping at
 * most `lookback` of them.
 *
 * The cap is not an optimisation bolted on afterwards, though it is worth about
 * two orders of magnitude on a long run. Live, the engine is handed exactly
 * `CANDLE_LIMIT` bars per timeframe and never sees further back than that. A
 * backtest that fed it the entire multi-year series would be grading a
 * different engine from the one that produces the signals on screen — one with
 * more structure, older zones and a longer memory — and the numbers would not
 * transfer.
 */
export function closedFrames(
  frames: Partial<Record<Timeframe, Candle[]>>,
  clock: number,
  lookback = Number.POSITIVE_INFINITY,
): Partial<Record<Timeframe, Candle[]>> {
  const out: Partial<Record<Timeframe, Candle[]>> = {};
  for (const [tf, series] of Object.entries(frames) as [Timeframe, Candle[] | undefined][]) {
    if (!series) continue;
    const closed = closedCandles(series, tf, clock);
    out[tf] = closed.length > lookback ? closed.slice(closed.length - lookback) : closed;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Inputs                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Why a signal the engine produced did not become a measured trade. Counted
 * rather than dropped: a run that skipped nine signals out of ten is reporting
 * on a tenth of the engine's behaviour, and the reader has to be able to see
 * that before believing the expectancy.
 */
export type SkipReason =
  | "positionOpen"
  | "zoneAlreadyTraded"
  | "noPlan"
  | "noTarget"
  | "stopOnWrongSide"
  | "targetOnWrongSide"
  | "noForwardCandles";

export const SKIP_REASONS: SkipReason[] = [
  "positionOpen",
  "zoneAlreadyTraded",
  "noPlan",
  "noTarget",
  "stopOnWrongSide",
  "targetOnWrongSide",
  "noForwardCandles",
];

export interface BacktestOptions {
  /**
   * Which scanner states count as "the engine called a trade". Defaults to
   * ENTRY_NOW alone, because that is the only state the UI presents as
   * actionable without further waiting.
   */
  states?: ScannerState[];
  /** Which of the three plans to trade. Defaults to Balanced. */
  plan?: EntryPlan["name"];
  /**
   * Bars to leave in front before the first analysis. The engine refuses to
   * grade anything under 60 candles anyway, so starting earlier only buys
   * NO_TRADE rows.
   */
  warmup?: number;
  /** Bars between analyses. 1 is faithful; higher is faster and coarser. */
  stride?: number;
  /** Bars a trade may stay open before it is closed at market. */
  horizon?: number;
  /**
   * Bars of each timeframe the engine is handed per step. Matches the live
   * `CANDLE_LIMIT` by default so the backtest grades the same engine the
   * screen does.
   */
  lookback?: number;
  /**
   * One trade per zone. A zone is one idea, and letting the same idea fire on
   * forty consecutive bars would stack forty near-identical outcomes into the
   * sample and call it evidence.
   */
  oncePerZone?: boolean;
}

export interface BacktestInput {
  asset: Asset;
  candles: Partial<Record<Timeframe, Candle[]>>;
  entryTimeframe?: Timeframe;
  dataStatus: DataStatus;
  options?: BacktestOptions;
}

/* -------------------------------------------------------------------------- */
/*  Outputs                                                                   */
/* -------------------------------------------------------------------------- */

export interface BacktestTrade {
  /**
   * The settled trade in the same shape the journal stores, so the backtest and
   * the trader's own record are summarised by identical code. Two definitions
   * of expectancy would eventually disagree, and the disagreement would land on
   * whichever screen the trader was reading at the time.
   */
  trade: Trade;
  grade: SetupQuality["grade"];
  score: number;
  scannerState: ScannerState;
  /** Index into the entry timeframe series of the bar that produced the signal. */
  signalIndex: number;
  barsHeld: number;
  exitKind: PracticeExitKind;
  /** One bar touched both the stop and the target; settled against us. */
  ambiguous: boolean;
}

export interface GradeReport {
  grade: SetupQuality["grade"];
  summary: PerformanceSummary;
  ambiguous: number;
  /** Trades that reached neither stop nor target inside the horizon. */
  windowClosed: number;
}

export const GRADES: SetupQuality["grade"][] = ["A", "B", "C", "D"];

export interface BacktestReport {
  symbol: string;
  timeframe: Timeframe;
  /** Open time of the first and last bar analysed. */
  from: number;
  to: number;
  /** How many times `analyze` ran. */
  analysed: number;
  /** How many of those produced a signal in one of the wanted states. */
  signals: number;
  skipped: Record<SkipReason, number>;
  trades: BacktestTrade[];
  overall: PerformanceSummary;
  byGrade: GradeReport[];
  /**
   * Does average R fall as the grade falls — A at least B at least C at least D?
   *
   * This is the question the whole module exists to answer, and it is the only
   * output worth acting on. Null when fewer than two grades reached
   * `EXPECTANCY_MIN_SAMPLE`, which on a few months of history is the usual
   * answer: a verdict from four trades is a coin landing heads, not evidence.
   */
  gradeOrderHolds: boolean | null;
}

/* -------------------------------------------------------------------------- */
/*  The run                                                                   */
/* -------------------------------------------------------------------------- */

const DEFAULTS = {
  states: ["ENTRY_NOW"] as ScannerState[],
  plan: "Balanced" as EntryPlan["name"],
  warmup: 120,
  stride: 1,
  horizon: 60,
  lookback: 400,
  oncePerZone: true,
};

export function backtest(input: BacktestInput): BacktestReport {
  const entryTimeframe = input.entryTimeframe ?? "15m";
  const options = { ...DEFAULTS, ...input.options };
  const wanted = new Set(options.states);
  const span = TIMEFRAME_SECONDS[entryTimeframe];
  const series = input.candles[entryTimeframe] ?? [];

  const skipped = emptySkips();
  const trades: BacktestTrade[] = [];
  const tradedZones = new Set<string>();

  let analysed = 0;
  let signals = 0;
  let from = 0;
  let to = 0;
  /** Index of the bar the open trade exits on; nothing new is taken before it. */
  let busyUntil = -1;

  const start = Math.max(options.warmup, 1);
  const stride = Math.max(options.stride, 1);

  for (let i = start; i < series.length - 1; i += stride) {
    const bar = series[i];
    if (!bar) continue;

    // The instant this bar finished. Everything the engine is allowed to see
    // is measured against it, including the bar itself — which qualifies,
    // because its own close is exactly this moment.
    const clock = bar.time + span;
    const visible = closedFrames(input.candles, clock, options.lookback);

    const result = analyze({
      asset: input.asset,
      candles: visible,
      entryTimeframe,
      dataStatus: input.dataStatus,
      now: clock,
    });
    analysed += 1;
    if (from === 0) from = bar.time;
    to = bar.time;

    const setup = result.best;
    if (!setup || !wanted.has(setup.scannerState)) continue;
    signals += 1;

    if (i <= busyUntil) {
      skipped.positionOpen += 1;
      continue;
    }
    const zoneId = setup.zone?.id ?? setup.id;
    if (options.oncePerZone && tradedZones.has(zoneId)) {
      skipped.zoneAlreadyTraded += 1;
      continue;
    }

    const taken = takeTrade({
      setup,
      plan: options.plan,
      entryPrice: bar.close,
      entryTime: bar.time,
      forward: series.slice(i + 1, i + 1 + options.horizon),
      signalIndex: i,
      skipped,
    });
    if (!taken) continue;

    trades.push(taken);
    tradedZones.add(zoneId);
    busyUntil = i + taken.barsHeld;
  }

  const all = trades.map((t) => t.trade);
  const byGrade = GRADES.map((grade) => {
    const slice = trades.filter((t) => t.grade === grade);
    return {
      grade,
      summary: summarizePerformance(slice.map((t) => t.trade)),
      ambiguous: slice.filter((t) => t.ambiguous).length,
      windowClosed: slice.filter((t) => t.exitKind === "window_close").length,
    };
  });

  return {
    symbol: input.asset.symbol,
    timeframe: entryTimeframe,
    from,
    to,
    analysed,
    signals,
    skipped,
    trades,
    overall: summarizePerformance(all),
    byGrade,
    gradeOrderHolds: gradeOrderHolds(byGrade),
  };
}

function emptySkips(): Record<SkipReason, number> {
  const out = {} as Record<SkipReason, number>;
  for (const reason of SKIP_REASONS) out[reason] = 0;
  return out;
}

/**
 * Turn one signal into a settled trade, or say why it could not be one.
 *
 * The fill is the signal bar's close: a market order placed the moment the
 * engine said "entry now". Filling at the plan's `bestPrice` instead would be
 * assuming a limit order that history never had to honour, and every such
 * assumption flatters the result.
 */
function takeTrade(params: {
  setup: Setup;
  plan: EntryPlan["name"];
  entryPrice: number;
  entryTime: number;
  forward: Candle[];
  signalIndex: number;
  skipped: Record<SkipReason, number>;
}): BacktestTrade | null {
  const { setup, entryPrice, entryTime, forward, signalIndex, skipped } = params;

  if (forward.length === 0) {
    skipped.noForwardCandles += 1;
    return null;
  }

  const plan = setup.plans.find((p) => p.name === params.plan) ?? setup.plans[0];
  if (!plan || plan.name === "No Trade") {
    skipped.noPlan += 1;
    return null;
  }
  const target = plan.takeProfits[0];
  if (!target) {
    skipped.noTarget += 1;
    return null;
  }

  const long = setup.direction === "long";
  if (setup.direction === "none") {
    skipped.noPlan += 1;
    return null;
  }

  // A plan whose stop sits on the wrong side of the actual fill has no risk to
  // measure against, so an R figure for it would be arithmetic on nonsense.
  // This happens when price ran through the zone between the plan being drawn
  // and the bar closing — real, and correctly refused rather than fudged.
  if (long ? plan.stopLoss >= entryPrice : plan.stopLoss <= entryPrice) {
    skipped.stopOnWrongSide += 1;
    return null;
  }
  if (long ? target.price <= entryPrice : target.price >= entryPrice) {
    skipped.targetOnWrongSide += 1;
    return null;
  }

  const resolution = resolvePracticeCall({
    direction: setup.direction,
    entryPrice,
    stopLoss: plan.stopLoss,
    takeProfit: target.price,
    forward,
  });
  if (!resolution) {
    skipped.noForwardCandles += 1;
    return null;
  }

  const risk = Math.abs(entryPrice - plan.stopLoss);
  const trade: Trade = {
    id: `bt-${setup.id}-${entryTime}`,
    symbol: setup.symbol,
    timeframe: setup.timeframe,
    direction: long ? "long" : "short",
    entryType: plan.entryType,
    entryPrice,
    stopLoss: plan.stopLoss,
    takeProfits: plan.takeProfits.map((t) => t.price),
    size: 1,
    openedAt: entryTime,
    closedAt: resolution.exitTime,
    exitPrice: resolution.exitPrice,
    mfeR: resolution.mfeR === null ? null : Number(resolution.mfeR.toFixed(2)),
    // `resolvePracticeCall` signs adverse excursion negative; the journal
    // stores it as a positive distance travelled against the trade.
    maeR: resolution.maeR === null ? null : Number(Math.abs(resolution.maeR).toFixed(2)),
    resultR: Number((resolution.movePrice / risk).toFixed(2)),
    classification: null,
    psychology: [],
    setupId: setup.id,
    notes: "",
  };

  return {
    trade,
    grade: setup.quality.grade,
    score: setup.quality.score,
    scannerState: setup.scannerState,
    signalIndex,
    barsHeld: resolution.barsHeld,
    exitKind: resolution.kind,
    ambiguous: resolution.ambiguous,
  };
}

/**
 * A grade is only worth printing if it predicts something, and it only predicts
 * something if the grades line up in order. Grades that never reached a usable
 * sample are left out of the comparison rather than counted as agreeing —
 * a single grade-A trade returning +2R is not the grade working.
 */
export function gradeOrderHolds(reports: GradeReport[]): boolean | null {
  const usable = reports.filter((r) => r.summary.trades >= EXPECTANCY_MIN_SAMPLE);
  if (usable.length < 2) return null;
  for (let i = 1; i < usable.length; i += 1) {
    const better = usable[i - 1];
    const worse = usable[i];
    if (!better || !worse) continue;
    if (worse.summary.expectancyR > better.summary.expectancyR) return false;
  }
  return true;
}
