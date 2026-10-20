import assert from "node:assert/strict";
import type { Candle, MtfAlignment, PullbackReading, SupplyDemandZone } from "@atc/types";
import { generateCandles, requireAsset } from "@atc/market-data";
import {
  dailyAtr,
  dayIndex,
  detectKeyLevels,
  groupPeriods,
  levelsInPath,
  roundStep,
  weekIndex,
  zoneConfluence,
} from "./levels";
import type { KeyLevel, KeyLevelKind } from "./levels";
import { scoreSetup } from "./scoring";
import { analyze } from "./setups";
import { p } from "./phrases";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  process.stdout.write(`  ok ${name}\n`);
}

const H4 = 14400;
const DAY = 86400;
/** 2023-11-13 00:00 UTC. Verified below to actually be a Monday. */
const MONDAY = Math.floor(Date.UTC(2023, 10, 13) / 1000);

interface DaySpec {
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Six 4H candles covering one UTC day, shaped so the day's OHLC is exactly the
 * spec: the open lands on the first bar, the high on the third, the low on the
 * fourth, the close on the last.
 */
function dayCandles(dayStart: number, spec: DaySpec): Candle[] {
  const mid = (spec.high + spec.low) / 2;
  const out: Candle[] = [];
  for (let i = 0; i < 6; i += 1) {
    const open = i === 0 ? spec.open : mid;
    const close = i === 5 ? spec.close : mid;
    out.push({
      time: dayStart + i * H4,
      open,
      high: i === 2 ? spec.high : Math.max(open, close),
      low: i === 3 ? spec.low : Math.min(open, close),
      close,
      volume: 100,
    });
  }
  return out;
}

/** `count` consecutive days starting at `start`, each walking `drift` higher. */
function series(start: number, count: number, base: number, drift: number): Candle[] {
  const out: Candle[] = [];
  for (let d = 0; d < count; d += 1) {
    const centre = base + d * drift;
    out.push(
      ...dayCandles(start + d * DAY, {
        open: centre - 2,
        high: centre + 10,
        low: centre - 10,
        close: centre + 2,
      }),
    );
  }
  return out;
}

function level(kind: KeyLevelKind, price: number, weight: number): KeyLevel {
  return { kind, price, weight, sealedAt: 0 };
}

function zone(overrides: Partial<SupplyDemandZone> = {}): SupplyDemandZone {
  return {
    id: "z",
    kind: "demand",
    timeframe: "15m",
    top: 110,
    bottom: 100,
    createdIndex: 10,
    createdTime: 1700000000,
    freshness: "fresh",
    tests: 0,
    reactionStrength: 80,
    structuralImpact: "caused_bos",
    htfAligned: true,
    score: 85,
    displacement: 1.8,
    timeInZone: 3,
    distanceTravelled: 4,
    invalidated: false,
    ...overrides,
  };
}

// --------------------------------------------------------------- calendars

test("the trading week starts on Monday, not on the Unix epoch's Thursday", () => {
  // The whole point of the offset in `weekIndex`. Without it the boundary lands
  // on Thursday, which would split every real FX week in half and make
  // "last week's high" the high of a Thursday-to-Wednesday window nobody
  // trades against.
  assert.equal(new Date(MONDAY * 1000).getUTCDay(), 1, "fixture must start on a Monday");

  const sunday = MONDAY - 1;
  const sameWeekLater = MONDAY + 6 * DAY + 23 * 3600;
  const nextMonday = MONDAY + 7 * DAY;

  assert.equal(weekIndex(MONDAY), weekIndex(sameWeekLater), "Monday and Sunday night are one week");
  assert.equal(weekIndex(sunday), weekIndex(MONDAY) - 1, "the Sunday before is the previous week");
  assert.equal(weekIndex(nextMonday), weekIndex(MONDAY) + 1, "the next Monday starts a new week");

  // A Thursday boundary would put these two in the same bucket.
  const wednesday = MONDAY + 2 * DAY;
  const thursday = MONDAY + 3 * DAY;
  assert.equal(weekIndex(wednesday), weekIndex(thursday), "Thursday must not open a week");
});

test("a gap in the candles produces no period, not an empty one", () => {
  // FX stops printing on Saturday and Sunday. A roll-up that filled the gap
  // with a zero-range period would hand `detectKeyLevels` a previous day whose
  // high and low are both 0, and every level derived from it would be garbage.
  const friday = MONDAY + 4 * DAY;
  const candles = [
    ...dayCandles(friday, { open: 100, high: 110, low: 90, close: 105 }),
    // Saturday and Sunday are missing entirely.
    ...dayCandles(friday + 3 * DAY, { open: 106, high: 120, low: 104, close: 118 }),
  ];

  const days = groupPeriods(candles, dayIndex);
  assert.equal(days.length, 2, "two days of candles must make exactly two days");
  assert.deepEqual(
    days.map((d) => ({ high: d.high, low: d.low })),
    [
      { high: 110, low: 90 },
      { high: 120, low: 104 },
    ],
  );
});

test("a period carries the first open and the last close, not the extremes of either", () => {
  const candles = dayCandles(MONDAY, { open: 100, high: 130, low: 70, close: 125 });
  const day = groupPeriods(candles, dayIndex)[0];
  assert.ok(day, "one day of candles must make one period");
  assert.equal(day.open, 100, "the period's open is the first candle's open");
  assert.equal(day.close, 125, "the period's close is the last candle's close");
  assert.equal(day.high, 130, "the period's high is the highest high in it");
  assert.equal(day.low, 70, "the period's low is the lowest low in it");
});

// ------------------------------------------------------------- lookahead

test("the day still being written is never read as the previous day", () => {
  // The lookahead guard. A 4H series always ends mid-session, so the final day
  // group is partial. Reading it as "yesterday" would mark a high that has not
  // finished forming — the single most expensive mistake this module could
  // make, because every downstream score would be built on a future price.
  const candles = [
    ...dayCandles(MONDAY, { open: 100, high: 110, low: 90, close: 105 }),
    ...dayCandles(MONDAY + DAY, { open: 105, high: 140, low: 95, close: 130 }),
    // In progress: a high far above anything that has settled.
    ...dayCandles(MONDAY + 2 * DAY, { open: 130, high: 500, low: 128, close: 480 }),
  ];

  const levels = detectKeyLevels(candles, { price: 480 });
  const high = levels.find((l) => l.kind === "prevDayHigh");
  const low = levels.find((l) => l.kind === "prevDayLow");
  const close = levels.find((l) => l.kind === "prevDayClose");

  assert.equal(high?.price, 140, "previous day's high must come from the last completed day");
  assert.equal(low?.price, 95);
  assert.equal(close?.price, 130);
  // Round numbers are a grid around current price and legitimately land
  // anywhere; the weekly levels are the next test's problem. The claim here is
  // that nothing the *day* levels report came out of the unfinished session.
  const daily = levels.filter((l) => l.kind.startsWith("prevDay"));
  assert.ok(
    !daily.some((l) => l.price === 500 || l.price === 128 || l.price === 480),
    `no day level may come from the unfinished day: ${daily.map((l) => `${l.kind}=${l.price}`).join(" ")}`,
  );
});

test("the week's open is published immediately, its high and low only after it closes", () => {
  // Asymmetric on purpose, and the asymmetry is the whole point: the open of
  // the current week is fixed the moment the week starts, so using it is not
  // lookahead. Its high and low are not, so they must come from the week before.
  const candles = [
    ...series(MONDAY, 7, 100, 0), // week one, flat around 100
    ...series(MONDAY + 7 * DAY, 3, 300, 0), // week two, in progress, far away
  ];

  const levels = detectKeyLevels(candles, { price: 300 });
  const weekHigh = levels.find((l) => l.kind === "prevWeekHigh");
  const weekLow = levels.find((l) => l.kind === "prevWeekLow");
  const weekOpen = levels.find((l) => l.kind === "weekOpen");

  assert.equal(weekHigh?.price, 110, "last week's high is last week's, not this week's");
  assert.equal(weekLow?.price, 90);
  assert.equal(weekOpen?.price, 298, "this week's open is the first candle of this week");
});

// ---------------------------------------------------------- round numbers

test("round-number spacing scales with the instrument, not with a hardcoded grid", () => {
  // A fixed step cannot serve gold and EURUSD at once: 50 on EURUSD is off the
  // chart, 0.01 on gold fires every few seconds. The ladder is anchored on the
  // daily range so a level is reached every day or two on any instrument.
  const cases: [name: string, dailyRange: number, expected: number][] = [
    ["gold", 30, 50],
    ["EURUSD", 0.007, 0.01],
    ["GBPUSD", 0.009, 0.01],
    ["USDJPY", 0.9, 1],
    ["BTC", 1800, 2500],
    ["a quiet day on gold", 12, 25],
  ];
  for (const [name, range, expected] of cases) {
    assert.equal(roundStep(range), expected, `${name}: ${range}/day should step by ${expected}`);
  }
  assert.equal(roundStep(0), 0, "no volatility means no meaningful grid");
  assert.equal(roundStep(Number.NaN), 0);
});

test("round numbers bracket price on both sides at an even spacing", () => {
  const candles = series(MONDAY, 10, 2000, 5);
  const price = 2043;
  const levels = detectKeyLevels(candles, { price, roundCount: 2 }).filter((l) => l.kind === "round");

  assert.equal(levels.length, 4, "two a side");
  const prices = levels.map((l) => l.price).sort((a, b) => a - b);
  assert.ok(prices.filter((v) => v < price).length >= 1, "at least one level below price");
  assert.ok(prices.filter((v) => v > price).length >= 1, "at least one level above price");

  const steps = prices.slice(1).map((v, i) => Number((v - (prices[i] ?? 0)).toPrecision(10)));
  assert.equal(new Set(steps).size, 1, `spacing must be even, got ${steps.join(",")}`);

  const step = steps[0] ?? 0;
  const completeDays = groupPeriods(candles, dayIndex).slice(0, -1);
  assert.ok(
    step >= dailyAtr(completeDays),
    `spacing ${step} must be at least one daily ATR ${dailyAtr(completeDays)}`,
  );
  for (const value of prices) {
    assert.ok(
      Math.abs(value / step - Math.round(value / step)) < 1e-6,
      `${value} is not a multiple of ${step}`,
    );
  }
});

test("the grid does not move while the current day is still printing", () => {
  // An unfinished day is a short day. If its stub range counted towards the
  // daily ATR, the grid would tighten as the session opened and loosen as it
  // filled out — the levels on a trader's chart would quietly shift between
  // two refreshes of the same unchanged history.
  const settledDays: DaySpec[] = [];
  for (let d = 0; d < 7; d += 1) settledDays.push({ open: 2000, high: 2013, low: 1987, close: 2000 });

  const history = settledDays.flatMap((spec, d) => dayCandles(MONDAY + d * DAY, spec));
  const finalDay = MONDAY + 7 * DAY;

  // Same seven settled days; the eighth is the one in progress.
  const justOpened = [
    ...history,
    ...dayCandles(finalDay, { open: 2000, high: 2000.5, low: 1999.5, close: 2000 }),
  ];
  const fullSession = [
    ...history,
    ...dayCandles(finalDay, { open: 2000, high: 2013, low: 1987, close: 2000 }),
  ];

  const grid = (candles: Candle[]): number[] =>
    detectKeyLevels(candles, { price: 2043 })
      .filter((l) => l.kind === "round")
      .map((l) => l.price)
      .sort((a, b) => a - b);

  assert.deepEqual(grid(justOpened), grid(fullSession), "the grid must not depend on today");

  // And the fixture is only meaningful if counting today *would* have moved it:
  // the two final days differ enough to cross a rung of the ladder.
  const allDays = groupPeriods(justOpened, dayIndex);
  assert.notEqual(
    roundStep(dailyAtr(allDays)),
    roundStep(dailyAtr(allDays.slice(0, -1))),
    "the stub day must be short enough to change the step if it were counted",
  );
});

// ------------------------------------------------------------- confluence

test("confluence decays with distance and dies past one ATR", () => {
  const levels = [level("prevDayHigh", 105, 1)];
  const inside = zoneConfluence(zone(), levels, 10).score;
  const close = zoneConfluence(zone(), [level("prevDayHigh", 112, 1)], 10).score;
  const near = zoneConfluence(zone(), [level("prevDayHigh", 115, 1)], 10).score;
  const far = zoneConfluence(zone(), [level("prevDayHigh", 125, 1)], 10).score;

  assert.ok(inside > close, `inside the zone (${inside}) must beat 0.2 ATR away (${close})`);
  assert.ok(close > near, `0.2 ATR (${close}) must beat 0.5 ATR (${near})`);
  assert.ok(near > far, `0.5 ATR (${near}) must beat 1.5 ATR (${far})`);
  assert.equal(far, 0, "a level more than an ATR away is not confluence");
});

test("a level out of range is dropped from the evidence, not listed at zero", () => {
  const result = zoneConfluence(zone(), [level("prevDayHigh", 400, 1)], 10);
  assert.equal(result.score, 0);
  assert.deepEqual(result.levels, [], "a level that contributes nothing must not be cited");
  assert.deepEqual(result.facts, [p("level.fact.none")]);
});

test("a hard reference outranks a soft one at the same distance", () => {
  // Yesterday's high is a price the whole market has marked. A round number is
  // only memorable. Scoring them alike would let an arbitrary multiple of 50
  // carry the same weight as a level that actually traded.
  const hard = zoneConfluence(zone(), [level("prevDayHigh", 105, 1)], 10).score;
  const soft = zoneConfluence(zone(), [level("round", 105, 0.6)], 10).score;
  assert.ok(hard > soft, `prevDayHigh (${hard}) must outrank a round number (${soft})`);
});

test("a cluster of soft levels cannot out-argue one hard level", () => {
  // The guard against additive scoring. Four round numbers inside a zone is
  // one fact restated four times; one previous-day high inside it is a
  // different, stronger fact.
  const cluster = zoneConfluence(
    zone(),
    [
      level("round", 101, 0.6),
      level("round", 104, 0.6),
      level("round", 107, 0.6),
      level("round", 109, 0.6),
    ],
    10,
  );
  const single = zoneConfluence(zone(), [level("prevDayHigh", 105, 1)], 10);

  assert.equal(cluster.levels.length, 4, "the fixture must put all four in range");
  assert.ok(
    single.score > cluster.score,
    `one hard level (${single.score}) must beat four soft ones (${cluster.score})`,
  );
  // But the cluster is still worth more than a lone round number, or the extra
  // evidence would be thrown away entirely.
  const lone = zoneConfluence(zone(), [level("round", 105, 0.6)], 10).score;
  assert.ok(cluster.score > lone, `four round numbers (${cluster.score}) must beat one (${lone})`);
});

test("the strongest level is cited first", () => {
  const result = zoneConfluence(
    zone(),
    [level("round", 105, 0.6), level("prevWeekLow", 106, 1), level("prevDayClose", 104, 0.7)],
    10,
  );
  assert.deepEqual(
    result.levels.map((l) => l.kind),
    ["prevWeekLow", "prevDayClose", "round"],
    "levels must be ordered by how much they actually contribute",
  );
  assert.equal(result.facts.length, 3, "every contributing level is stated as a fact");
});

// ----------------------------------------------------------------- path

test("a level between entry and target is an obstacle, not confluence", () => {
  const levels = [
    level("prevDayLow", 95, 1),
    level("round", 100, 0.6),
    level("prevDayHigh", 110, 1),
    level("weekOpen", 120, 0.8),
    level("round", 130, 0.6),
    level("prevWeekHigh", 140, 1),
  ];

  const long = levelsInPath(100, 130, levels);
  assert.deepEqual(
    long.map((l) => l.price),
    [110, 120],
    "only levels strictly between the two prices, nearest to the entry first",
  );

  const short = levelsInPath(130, 100, levels);
  assert.deepEqual(
    short.map((l) => l.price),
    [120, 110],
    "a short meets the same levels in the opposite order",
  );

  assert.deepEqual(levelsInPath(100, 100, levels), [], "a zero-length path has no obstacles");
});

// -------------------------------------------------------------- scoring

const alignedMtf: MtfAlignment = {
  legs: [
    { timeframe: "4h", trend: "bullish", phase: "continuation" },
    { timeframe: "1h", trend: "bullish", phase: "continuation" },
    { timeframe: "15m", trend: "weak_bullish", phase: "weakening" },
    { timeframe: "5m", trend: "weak_bullish", phase: "consolidation" },
  ],
  agreement: 90,
  conflict: null,
};
const cleanPullback: PullbackReading = { verdict: "pullback", strength: 80, reasons: [] };

function quality(confluenceScore: number | null) {
  return scoreSetup({
    zone: zone({ score: 85 }),
    htfTrend: "bullish",
    mtf: alignedMtf,
    pullback: cleanPullback,
    regime: "trending_up",
    riskReward: 2.5,
    pendingConfirmations: 0,
    direction: "long",
    confluence:
      confluenceScore === null
        ? null
        : { score: confluenceScore, levels: [level("prevDayLow", 105, 1)], facts: [] },
  });
}

test("adding a component keeps the weights a set of shares, summing to 1", () => {
  const withConfluence = quality(80);
  assert.equal(withConfluence.components.length, 8, "confluence must be a visible component");

  const total = withConfluence.components.reduce((sum, c) => sum + c.weight, 0);
  assert.ok(
    Math.abs(total - 1) < 1e-9,
    `weights must still sum to 1 with confluence, got ${total}`,
  );

  // The UI prints each weight as a whole percent; if the shares do not round to
  // 100 the breakdown visibly does not add up.
  const percents = withConfluence.components.reduce((sum, c) => sum + Math.round(c.weight * 100), 0);
  assert.equal(percents, 100, `displayed percentages must add to 100, got ${percents}`);
});

test("confluence dilutes the other components instead of inflating the total", () => {
  // The grade thresholds (80 = A) are fixed and the journal is full of scores
  // produced by the seven-component model. If a new component were simply
  // added on top, every one of those historical grades would silently mean
  // something stricter than the grades printed from today on.
  const base = quality(null).score;
  const matched = quality(base).score;
  assert.ok(
    Math.abs(matched - base) <= 1,
    `a component scoring exactly the current total must not move it: ${base} -> ${matched}`,
  );

  const perfect = quality(100).score;
  assert.ok(base < 100, "the fixture must leave room above, or the test proves nothing");
  assert.ok(perfect > base, `a backed zone (${perfect}) must outscore an unmarked one (${base})`);
});

test("omitting confluence is not the same as scoring it zero", () => {
  // Callers with no higher-timeframe series must not be punished for it. An
  // engine run on 15m alone should grade exactly as it did before this module
  // existed, not take a haircut for information it was never given.
  const omitted = quality(null);
  const zeroed = quality(0);
  assert.equal(omitted.components.length, 7, "no confluence means no confluence component");
  assert.ok(
    omitted.score > zeroed.score,
    `unknown (${omitted.score}) must not be scored as known-absent (${zeroed.score})`,
  );
});

// ------------------------------------------------------------ end to end

function aggregate(base: Candle[], factor: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i + factor <= base.length; i += factor) {
    const slice = base.slice(i, i + factor);
    const first = slice[0];
    const last = slice[slice.length - 1];
    if (!first || !last) continue;
    out.push({
      time: first.time,
      open: first.open,
      high: Math.max(...slice.map((c) => c.high)),
      low: Math.min(...slice.map((c) => c.low)),
      close: last.close,
      volume: slice.reduce((sum, c) => sum + c.volume, 0),
    });
  }
  return out;
}

test("the engine reaches the key levels from the chain it already loaded", () => {
  // The point of the whole module: no extra request, no extra credit. If this
  // ever needs a `1d` series to work, the feature has quietly started costing
  // money on every scan of every symbol.
  const base = generateCandles(
    { symbol: "XAUUSD", timeframe: "15m", limit: 800, endTime: 1700000000 },
    { seed: 5 },
  );
  const result = analyze({
    asset: requireAsset("XAUUSD"),
    candles: { "5m": base, "15m": base, "1h": aggregate(base, 4), "4h": aggregate(base, 16) },
    entryTimeframe: "15m",
    dataStatus: {
      quality: "LIVE",
      provider: "test",
      lastCandleTime: 1700000000,
      candleCount: base.length,
    },
    now: 1700000000,
  });

  assert.ok(result.keyLevels.length > 0, "a 4H chain must produce key levels");
  const kinds = new Set(result.keyLevels.map((l) => l.kind));
  for (const required of ["prevDayHigh", "prevDayLow", "prevDayClose", "weekOpen", "round"]) {
    assert.ok(kinds.has(required as KeyLevelKind), `missing ${required} from ${[...kinds].join(",")}`);
  }

  const withZone = result.setups.find((s) => s.zone !== null);
  assert.ok(withZone, "the fixture must produce at least one zone-backed setup");
  const component = withZone.quality.components.find((c) => c.key === "confluence");
  assert.ok(component, "a zone-backed setup must be graded on key-level confluence");

  // The score has to come from the levels the result reports, not from some
  // other set computed elsewhere — otherwise the breakdown shown to the trader
  // cites evidence the grade was not actually built from.
  const zoneOfSetup = withZone.zone;
  assert.ok(zoneOfSetup);
  assert.equal(
    component.score,
    zoneConfluence(zoneOfSetup, result.keyLevels, result.atr).score,
    "the graded confluence must be the confluence of the reported levels",
  );
  assert.ok(component.score > 0, "the fixture must find real confluence, or nothing is proven");

  const total = withZone.quality.components.reduce((sum, c) => sum + c.weight, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `weights must sum to 1 end to end, got ${total}`);
});

process.stdout.write(`\nlevels.test.ts: ${passed} passed\n`);
