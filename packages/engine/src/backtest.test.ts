import assert from "node:assert/strict";
import type { Candle, DataStatus, ScannerState, Timeframe } from "@atc/types";
import { generateCandles, requireAsset } from "@atc/market-data";

import {
  backtest,
  closedCandles,
  closedFrames,
  gradeOrderHolds,
  GRADES,
  SKIP_REASONS,
  type BacktestOptions,
  type GradeReport,
} from "./backtest";
import { EXPECTANCY_MIN_SAMPLE } from "./risk";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  process.stdout.write(`  ok ${name}\n`);
}

const GOLD = requireAsset("XAUUSD");

const STATUS: DataStatus = {
  quality: "LIVE",
  provider: "test",
  lastCandleTime: 0,
  candleCount: 0,
};

/* -------------------------------------------------------------------------- */
/*  Fixtures                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The mock generator's seeded random walk, aggregated into a consistent
 * timeframe set.
 *
 * Aggregating rather than generating each timeframe separately matters here:
 * the 4H bars have to be made of the same price action as the 15M bars, or the
 * "rewriting the future" test below proves nothing — a tampered 15M tail would
 * leave an untouched 4H series to leak from.
 */
function aggregate(base: Candle[], factor: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i + factor <= base.length; i += factor) {
    const group = base.slice(i, i + factor);
    const first = group[0];
    const last = group[group.length - 1];
    if (!first || !last) continue;
    out.push({
      time: first.time,
      open: first.open,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      close: last.close,
      volume: group.reduce((sum, c) => sum + c.volume, 0),
    });
  }
  return out;
}

function frames(base: Candle[]): Partial<Record<Timeframe, Candle[]>> {
  return { "5m": base, "15m": base, "1h": aggregate(base, 4), "4h": aggregate(base, 16) };
}

function history(seed: number, limit = 800): Candle[] {
  return generateCandles({ symbol: "XAUUSD", timeframe: "15m", limit, endTime: 1700000000 }, { seed });
}

/**
 * Everything the scanner promotes out of the watchlist. ENTRY_NOW alone fires
 * perhaps twice in a thousand bars of random walk, which is the engine being
 * selective rather than broken, but it is too rare to build a guard on.
 */
const TRADABLE: ScannerState[] = ["ENTRY_NOW", "WAIT_CONFIRMATION", "LIMIT_ZONE"];

const BASE_OPTIONS: BacktestOptions = {
  states: TRADABLE,
  warmup: 130,
  stride: 5,
  horizon: 8,
};

function run(series: Candle[], options: BacktestOptions = {}) {
  return backtest({
    asset: GOLD,
    candles: frames(series),
    entryTimeframe: "15m",
    dataStatus: STATUS,
    options: { ...BASE_OPTIONS, ...options },
  });
}

// Each run re-analyses the chart ~130 times, so the shared ones are computed
// once and asserted against repeatedly rather than per test.
const REPORT = run(history(3));
const MIXED = run(history(4));

/* -------------------------------------------------------------------------- */
/*  Lookahead                                                                 */
/* -------------------------------------------------------------------------- */

test("a higher-timeframe candle that has not finished printing is not visible", () => {
  // The whole harness rests on this one comparison. A 4H bar carries its
  // *open* time, so the obvious filter — `time <= clock` — hands the engine
  // four hours of price action that had not happened yet, and does it
  // silently: the report comes back flattering and nothing in it looks wrong.
  const fourHour: Candle[] = [
    { time: 0, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 },
    { time: 14400, open: 1.5, high: 9, low: 1, close: 8, volume: 1 },
  ];

  assert.equal(closedCandles(fourHour, "4h", 28799).length, 1, "a forming bar was counted as closed");
  assert.equal(closedCandles(fourHour, "4h", 28800).length, 2, "a bar that just closed was dropped");
  assert.ok(
    closedCandles(fourHour, "4h", 20000).every((c) => c.high < 9),
    "a forming candle leaked its future high",
  );
});

test("truncation applies each timeframe's own close rule, not one rule for all", () => {
  const base = history(3, 64);
  const clock = (base[31]?.time ?? 0) + 900;
  const visible = closedFrames(frames(base), clock);

  assert.equal(visible["15m"]?.length, 32, "32 closed 15m bars");
  assert.equal(visible["1h"]?.length, 8, "32 quarter-hours is 8 closed hours");
  assert.equal(visible["4h"]?.length, 2, "32 quarter-hours is 2 closed 4H bars");

  for (const [tf, span] of [
    ["15m", 900],
    ["1h", 3600],
    ["4h", 14400],
  ] as [Timeframe, number][]) {
    for (const candle of visible[tf] ?? []) {
      assert.ok(candle.time + span <= clock, `${tf} bar at ${candle.time} had not closed by ${clock}`);
    }
  }
});

test("the engine is handed no more history than it gets live", () => {
  // Live it receives CANDLE_LIMIT bars per timeframe and nothing older. A
  // backtest that fed it the whole multi-year series would be grading an
  // engine with a longer memory than the one on screen, and the numbers would
  // not transfer to the thing the trader is actually reading.
  const base = history(3);
  const clock = (base[base.length - 1]?.time ?? 0) + 900;
  const capped = closedFrames(frames(base), clock, 50);
  for (const tf of ["5m", "15m", "1h", "4h"] as Timeframe[]) {
    assert.ok((capped[tf]?.length ?? 0) <= 50, `${tf} kept more than the lookback allows`);
  }
  // The window is the newest bars, not the oldest.
  assert.equal(capped["15m"]?.[49]?.time, base[base.length - 1]?.time);
});

test("rewriting the future does not change a trade that already settled", () => {
  // The direct test of the claim the report makes. Two histories agree bar for
  // bar up to a cut, then diverge violently. Every trade whose entry *and*
  // whole horizon sit before the cut must come out identical; if any part of
  // the engine reads forward, the tripled tail changes the read and the two
  // runs disagree.
  const cut = 600;
  const honest = history(3);
  const tampered = honest.map((c, i) =>
    i < cut ? c : { ...c, open: c.open * 3, high: c.high * 3.2, low: c.low * 2.8, close: c.close * 3 },
  );

  const after = run(tampered);
  const settled = (r: typeof REPORT) =>
    r.trades
      .filter((t) => t.signalIndex + (BASE_OPTIONS.horizon ?? 0) < cut)
      .map((t) => `${t.signalIndex}:${t.grade}:${t.trade.resultR}:${t.trade.exitPrice}`);

  const before = settled(REPORT);
  assert.ok(before.length >= 2, `need settled trades before the cut to compare, got ${before.length}`);
  assert.deepEqual(settled(after), before, "the future changed a trade that was already over");

  // And the tamper has to actually be capable of changing something, or the
  // assertion above is two empty hands agreeing with each other.
  assert.notDeepEqual(
    after.trades.map((t) => t.signalIndex),
    REPORT.trades.map((t) => t.signalIndex),
    "the tampered tail changed nothing at all, so the comparison proves nothing",
  );
});

/* -------------------------------------------------------------------------- */
/*  Accounting                                                                */
/* -------------------------------------------------------------------------- */

test("every signal is either a trade or a counted skip", () => {
  // A harness that quietly discards signals reports on a sample it never
  // describes. The reader has to be able to subtract: nine skips out of ten
  // signals means the expectancy below covers a tenth of the engine.
  assert.ok(REPORT.signals > 0, "the fixture produced no signals at all");
  const skips = SKIP_REASONS.reduce((sum, r) => sum + REPORT.skipped[r], 0);
  assert.equal(
    REPORT.trades.length + skips,
    REPORT.signals,
    `${REPORT.signals} signals but ${REPORT.trades.length} trades and ${skips} skips`,
  );
  assert.ok(skips > 0, "the fixture skipped nothing, so the accounting is untested");
});

test("a trade is settled against the bars that came after it, never its own", () => {
  assert.ok(REPORT.trades.length > 0, "no trades to check");
  for (const t of REPORT.trades) {
    assert.ok(t.trade.closedAt !== null, "a backtest trade must be closed");
    assert.ok(
      (t.trade.closedAt ?? 0) > t.trade.openedAt,
      `trade exited at ${t.trade.closedAt} on or before its entry ${t.trade.openedAt}`,
    );
    assert.ok(
      t.barsHeld >= 1 && t.barsHeld <= (BASE_OPTIONS.horizon ?? 0),
      `held for ${t.barsHeld} bars, outside the horizon`,
    );
  }
});

test("excursions are stored the way the journal stores them", () => {
  // `resolvePracticeCall` signs adverse excursion negative because it measures
  // everything in the call's favour. `Trade.maeR` is a distance travelled
  // against the position and the journal renders it as one, so a negative here
  // would print "worst drawdown -1.4R" and read as a profit.
  const checked = REPORT.trades.filter((t) => t.trade.maeR !== null);
  assert.ok(checked.length > 0, "no excursions recorded");
  for (const t of checked) {
    assert.ok((t.trade.maeR ?? 0) >= 0, `maeR ${t.trade.maeR} is signed against the journal's convention`);
    assert.ok((t.trade.mfeR ?? 0) >= 0, `mfeR ${t.trade.mfeR} is negative`);
  }
  assert.ok(
    checked.some((t) => (t.trade.maeR ?? 0) > 0),
    "every trade had a zero drawdown, so the sign above is untested",
  );
});

test("R is measured from the fill that happened, not the entry the plan wanted", () => {
  // The plan quotes an entry zone it hoped for; the backtest fills at the
  // signal bar's close, which is where a market order would actually have gone
  // on. Measuring R against the plan's intended entry would report a trade
  // that was never available at a price that never printed.
  assert.ok(MIXED.trades.length > 0, "no trades to check");
  assert.ok(
    MIXED.trades.some((t) => Math.abs(t.trade.resultR ?? 0) !== 1),
    "every trade settled at exactly 1R, which any entry reference would reproduce",
  );
  for (const t of MIXED.trades) {
    const { entryPrice, stopLoss, exitPrice, direction, resultR } = t.trade;
    const risk = Math.abs(entryPrice - stopLoss);
    assert.ok(risk > 0, "a trade was recorded with no risk to measure");
    const plan = t.trade.takeProfits.length > 0 ? t.trade : null;
    assert.ok(plan, "a trade was recorded with no target");
    const pnl = direction === "long" ? (exitPrice ?? 0) - entryPrice : entryPrice - (exitPrice ?? 0);
    assert.equal(
      resultR,
      Number((pnl / risk).toFixed(2)),
      `R disagrees with the fill: ${entryPrice} -> ${exitPrice} against stop ${stopLoss}`,
    );
  }
});

test("the same zone is not traded twice", () => {
  // Price sits in a demand zone for a dozen bars and the scanner keeps saying
  // the same thing about it. Counting that as a dozen trades would stack one
  // idea into the sample twelve times and call the repetition evidence.
  const zones = MIXED.trades.map((t) => t.trade.setupId);
  assert.equal(new Set(zones).size, zones.length, "a zone was traded more than once");
  assert.ok(MIXED.skipped.zoneAlreadyTraded > 0, "the fixture never re-signalled a traded zone");
});

/* -------------------------------------------------------------------------- */
/*  The verdict                                                               */
/* -------------------------------------------------------------------------- */

function gradeReport(grade: GradeReport["grade"], trades: number, expectancyR: number): GradeReport {
  return {
    grade,
    summary: {
      trades,
      wins: 0,
      losses: 0,
      winRate: 0,
      expectancyR,
      profitFactor: 0,
      totalR: Number((expectancyR * trades).toFixed(2)),
      maxDrawdownR: 0,
      averageWinR: 0,
      averageLossR: 0,
    },
    ambiguous: 0,
    windowClosed: 0,
  };
}

test("the grade verdict refuses to answer on a sample too thin to answer with", () => {
  // The dangerous output is not a wrong verdict, it is a confident one. Three
  // grade-A trades averaging +2R is a coin landing heads; reporting that as
  // "the grade works" hands the trader a reason to size up on noise.
  const thin = [
    gradeReport("A", EXPECTANCY_MIN_SAMPLE - 1, 2.0),
    gradeReport("B", EXPECTANCY_MIN_SAMPLE - 1, -1.0),
    gradeReport("C", 0, 0),
    gradeReport("D", 0, 0),
  ];
  assert.equal(gradeOrderHolds(thin), null, "a verdict was issued on an unusable sample");

  const oneUsable = [
    gradeReport("A", EXPECTANCY_MIN_SAMPLE, 2.0),
    gradeReport("B", EXPECTANCY_MIN_SAMPLE - 1, -1.0),
    gradeReport("C", 0, 0),
    gradeReport("D", 0, 0),
  ];
  assert.equal(gradeOrderHolds(oneUsable), null, "one grade cannot be compared with itself");
});

test("the grade verdict fails when a worse grade out-earns a better one", () => {
  const ordered = [
    gradeReport("A", EXPECTANCY_MIN_SAMPLE, 0.6),
    gradeReport("B", EXPECTANCY_MIN_SAMPLE, 0.3),
    gradeReport("C", EXPECTANCY_MIN_SAMPLE, -0.1),
    gradeReport("D", 0, 0),
  ];
  assert.equal(gradeOrderHolds(ordered), true);

  const inverted = [
    gradeReport("A", EXPECTANCY_MIN_SAMPLE, 0.1),
    gradeReport("B", EXPECTANCY_MIN_SAMPLE, 0.9),
    gradeReport("C", EXPECTANCY_MIN_SAMPLE, -0.1),
    gradeReport("D", 0, 0),
  ];
  assert.equal(gradeOrderHolds(inverted), false, "B beat A and the verdict still said yes");

  // A grade that never reached a usable sample sits out rather than counting
  // as agreement — an empty row must not be able to turn a false into a true.
  const gapped = [
    gradeReport("A", EXPECTANCY_MIN_SAMPLE, 0.1),
    gradeReport("B", 2, 99),
    gradeReport("C", EXPECTANCY_MIN_SAMPLE, 0.4),
    gradeReport("D", 0, 0),
  ];
  assert.equal(gradeOrderHolds(gapped), false, "C beat A across a skipped grade");
});

test("the report names every grade even when a grade never traded", () => {
  // A table that silently omits grade D reads as "no D setups were taken",
  // which is a different claim from "D setups were taken and lost money".
  assert.deepEqual(
    REPORT.byGrade.map((g) => g.grade),
    GRADES,
  );
  assert.equal(
    REPORT.overall.trades,
    REPORT.byGrade.reduce((sum, g) => sum + g.summary.trades, 0),
    "the per-grade rows do not add up to the total",
  );
  assert.equal(REPORT.gradeOrderHolds, null, "a few hundred bars cannot settle the grade question");
});

process.stdout.write(`\nbacktest.test.ts: ${passed} passed\n`);
