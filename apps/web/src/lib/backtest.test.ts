import assert from "node:assert/strict";
import test from "node:test";

import { MTF_CHAIN } from "@atc/types";
import type { BacktestReport, GradeReport, PerformanceSummary } from "@atc/engine";

import {
  BACKTEST_MODES,
  BACKTEST_TIMEFRAMES,
  DEFAULT_BACKTEST_MODE,
  DEFAULT_BACKTEST_TIMEFRAME,
  backtestVerdict,
  hasUsableSample,
  modeStates,
  parseBacktestRequest,
} from "./backtest";

/**
 * The backtest's two ways of misleading.
 *
 * It costs nothing to run and it cannot crash the page, so neither of the
 * usual pressures applies. What it can do is answer a question it has no
 * evidence for. Every assertion here is about keeping "we cannot say yet"
 * distinct from "yes" and from "no" — on a few hundred bars of history the
 * unanswerable case is the common one, so whichever way it gets collapsed is
 * the answer the user sees most.
 */

function summary(overrides: Partial<PerformanceSummary> = {}): PerformanceSummary {
  return {
    trades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    expectancyR: 0,
    profitFactor: 0,
    totalR: 0,
    maxDrawdownR: 0,
    averageWinR: 0,
    averageLossR: 0,
    ...overrides,
  };
}

function grade(g: GradeReport["grade"], trades: number, expectancyR: number): GradeReport {
  return {
    grade: g,
    summary: summary({ trades, expectancyR }),
    ambiguous: 0,
    windowClosed: 0,
  };
}

/** A report with `n` settled trades, shaped only where the verdict reads it. */
function report(overrides: Partial<BacktestReport> = {}): BacktestReport {
  return {
    symbol: "XAUUSD",
    timeframe: "15m",
    from: 1_700_000_000,
    to: 1_700_300_000,
    analysed: 280,
    signals: 12,
    skipped: {
      positionOpen: 0,
      zoneAlreadyTraded: 0,
      noPlan: 0,
      noTarget: 0,
      stopOnWrongSide: 0,
      targetOnWrongSide: 0,
      noForwardCandles: 0,
    },
    trades: [],
    overall: summary(),
    byGrade: [],
    gradeOrderHolds: null,
    ...overrides,
  };
}

/** `trades` is only ever read for its length by the code under test. */
function settled(n: number): BacktestReport["trades"] {
  return new Array(n).fill(null) as unknown as BacktestReport["trades"];
}

test("the backtest only runs on timeframes the scan has already paid for", () => {
  // The candle cache keys on {symbol, timeframe, limit}. A timeframe outside
  // the scan's chain is a cache miss, and on gold — the one metered market —
  // a cache miss is credits spent to ask a question about the past. This is
  // the whole reason the list is a constant rather than "any timeframe".
  for (const timeframe of BACKTEST_TIMEFRAMES) {
    assert.ok(
      MTF_CHAIN.includes(timeframe),
      `${timeframe} is not in the chain the scan loads, so backtesting it costs credits`,
    );
  }
  assert.ok(BACKTEST_TIMEFRAMES.includes(DEFAULT_BACKTEST_TIMEFRAME), "the default must be offerable");
});

test("a timeframe the server never loaded is refused, not reported as an empty run", () => {
  // backtest() reads candles[entryTimeframe]; for an unloaded frame that is
  // undefined, which yields a report of zero analyses and zero trades. On
  // screen that is identical to "the engine found nothing worth trading", so
  // a bad query string would read as a quiet market.
  for (const timeframe of ["1d", "30m", "1m", "4h", "nonsense"]) {
    const parsed = parseBacktestRequest({ symbol: "XAUUSD", timeframe });
    assert.equal(parsed.ok, false, `${timeframe} must be refused`);
  }
});

test("a symbol the catalogue does not know never reaches the engine", () => {
  // requireAsset throws on an unknown symbol, and this route builds its own
  // asset rather than inheriting one from a scan.
  assert.equal(parseBacktestRequest({ symbol: "DOGECOIN" }).ok, false);
  assert.equal(parseBacktestRequest({ symbol: "" }).ok, false);
  assert.equal(parseBacktestRequest({ symbol: null }).ok, false);
});

test("a valid request is normalised rather than passed through", () => {
  const parsed = parseBacktestRequest({ symbol: " xauusd ", timeframe: "1h", mode: "entry" });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.ok && parsed.request, { symbol: "XAUUSD", timeframe: "1h", mode: "entry" });

  const defaulted = parseBacktestRequest({ symbol: "BTCUSDT" });
  assert.equal(defaulted.ok && defaulted.request.timeframe, DEFAULT_BACKTEST_TIMEFRAME);
  assert.equal(defaulted.ok && defaulted.request.mode, DEFAULT_BACKTEST_MODE);

  assert.equal(parseBacktestRequest({ symbol: "XAUUSD", mode: "everything" }).ok, false);
});

test("no mode ever settles a trade the engine said to stay out of", () => {
  // NO_TRADE is the engine declining. Settling it would score the system on
  // decisions it advised against, and the resulting R would belong to nobody.
  for (const mode of BACKTEST_MODES) {
    const states = modeStates(mode);
    assert.ok(states.length > 0, `${mode} must settle something`);
    assert.equal(states.includes("NO_TRADE"), false, `${mode} must not trade NO_TRADE`);
  }
});

test("the strict mode is a subset of the graded one", () => {
  // The two modes answer nested questions: "were the actionable calls good"
  // sits inside "is the grade meaningful". If `entry` ever admitted a state
  // `graded` excludes, the narrower run could report trades the wider one
  // missed, and the pair would stop being comparable.
  const graded = new Set(modeStates("graded"));
  for (const state of modeStates("entry")) {
    assert.ok(graded.has(state), `${state} is in entry but not in graded`);
  }
  assert.ok(modeStates("graded").length > modeStates("entry").length, "graded must be the wider net");
});

test("an unanswered question is never rendered as a pass", () => {
  // The engine says "not enough evidence" with null, and null is falsy. A tick
  // when true and a cross otherwise turns that into "the grading is broken";
  // `?? true` turns it into a pass the sample does not support. On a few
  // hundred bars null is the usual answer, so either collapse becomes the
  // reading the user sees most often.
  const unanswered = report({ gradeOrderHolds: null, trades: settled(7) });
  assert.equal(backtestVerdict(unanswered), "thin");
  assert.notEqual(backtestVerdict(unanswered), "holds");
  assert.notEqual(backtestVerdict(unanswered), "inverted");
});

test("the two answers the engine can actually give are passed through", () => {
  const holds = report({
    gradeOrderHolds: true,
    trades: settled(44),
    byGrade: [grade("A", 22, 0.6), grade("B", 22, 0.2)],
  });
  const inverted = report({
    gradeOrderHolds: false,
    trades: settled(44),
    byGrade: [grade("A", 22, 0.1), grade("B", 22, 0.5)],
  });

  assert.equal(backtestVerdict(holds), "holds");
  assert.equal(backtestVerdict(inverted), "inverted");
});

test("an engine that declined to trade is not reported as a broken run", () => {
  // Four quiet days with no ENTRY_NOW is the system working as designed. It
  // must not look like a backtest that failed to start, or the one honest
  // output of a selective engine reads as a bug.
  const quiet = report({ analysed: 280, signals: 0, trades: [] });
  assert.equal(backtestVerdict(quiet), "noSignals");

  const never = report({ analysed: 0, signals: 0, trades: [] });
  assert.equal(backtestVerdict(never), "noRun");
  assert.notEqual(backtestVerdict(never), backtestVerdict(quiet), "the two must stay distinguishable");
});

test("a headline expectancy is withheld until the sample can support one", () => {
  // One trade's R printed to two decimals looks exactly like a measured edge.
  assert.equal(hasUsableSample(report({ overall: summary({ trades: 1, expectancyR: 2.0 }) })), false);
  assert.equal(hasUsableSample(report({ overall: summary({ trades: 19 }) })), false);
  assert.equal(hasUsableSample(report({ overall: summary({ trades: 20 }) })), true);
});
