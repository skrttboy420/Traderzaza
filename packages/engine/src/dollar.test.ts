import assert from "node:assert/strict";
import type { Candle, MtfAlignment, PullbackReading, SupplyDemandZone } from "@atc/types";
import { generateCandles, requireAsset } from "@atc/market-data";
import { DOLLAR_LOOKBACK, buildDollarContext, dollarAlignment, dollarExposure } from "./dollar";
import type { DollarAlignment, DollarContext } from "./dollar";
import { scoreSetup } from "./scoring";
import { analyze } from "./setups";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  process.stdout.write(`  ok ${name}\n`);
}

const H4 = 14400;
const START = 1700000000;

/**
 * A 4H series whose close is exactly `changePct` above where it was
 * `DOLLAR_LOOKBACK` bars ago.
 *
 * The bars *before* the window are deliberately flat at `start`. That makes
 * the fixture indifferent to how far back the module reaches — which is the
 * point: a test that only passes because the lookback is 30 would break on a
 * tuning change rather than on a behaviour change. The one test that cares
 * about the window boundary says so explicitly.
 */
function pair(start: number, changePct: number, bars = 60): Candle[] {
  const end = start * (1 + changePct / 100);
  const firstMoving = bars - 1 - DOLLAR_LOOKBACK;
  const out: Candle[] = [];
  for (let i = 0; i < bars; i += 1) {
    const stepsIn = i - firstMoving;
    const close = stepsIn <= 0 ? start : start + (end - start) * (stepsIn / DOLLAR_LOOKBACK);
    out.push({
      time: START + i * H4,
      open: close,
      high: close * 1.001,
      low: close * 0.999,
      close,
      volume: 100,
    });
  }
  return out;
}

/** EUR / GBP / JPY moves in percent, as each pair itself prints them. */
function basket(eurPct: number, gbpPct: number, jpyPct: number, bars = 60) {
  return {
    EURUSD: pair(1.08, eurPct, bars),
    GBPUSD: pair(1.27, gbpPct, bars),
    USDJPY: pair(151.4, jpyPct, bars),
  };
}

function require_<T>(value: T | null | undefined, message: string): T {
  assert.ok(value !== null && value !== undefined, message);
  return value;
}

// ------------------------------------------------------------- exposure

test("a pair with the dollar on the left moves opposite to one with it on the right", () => {
  // The single fact the whole module turns on. USDJPY rising *is* the dollar
  // rising; EURUSD rising is the dollar falling. Treating the two alike would
  // not merely weaken the index, it would make the yen leg cancel the euro leg
  // on exactly the weeks when they agree.
  assert.equal(dollarExposure("USDJPY"), 1, "USD as the base currency rises with the dollar");
  assert.equal(dollarExposure("EURUSD"), -1, "USD as the quote currency falls as the dollar rises");
  assert.equal(dollarExposure("GBPUSD"), -1, "sterling is quoted in dollars");
  assert.equal(dollarExposure("XAUUSD"), -1, "gold is priced in dollars, so a gold long is a dollar short");
  assert.equal(dollarExposure("BTCUSDT"), -1, "a dollar stablecoin is still the dollar side");
  assert.equal(dollarExposure("EURGBP"), 0, "a cross with no dollar leg has no dollar exposure");
});

// ---------------------------------------------------------------- index

test("pairs falling against the dollar and a pair rising with it all read as strength", () => {
  // EUR and GBP down, USDJPY up: three different prints, one story.
  const ctx = require_(buildDollarContext(basket(-1, -1, 1)), "three full legs must build a context");

  assert.ok(ctx.strength > 0, `the dollar gained on every leg, got strength ${ctx.strength}`);
  assert.equal(ctx.move, "strengthening");
  assert.equal(ctx.agreement, 100, "every leg points the same way");
  assert.equal(ctx.legs.length, 3);
});

test("the index is weighted, not averaged", () => {
  // Sterling moves twice as far as the euro and the opposite way. The euro
  // still wins, because it is 58% of the real DXY and sterling is 12%. A plain
  // mean of the three legs would call this a weak dollar.
  const ctx = require_(buildDollarContext(basket(-1, 2, 0)), "three full legs must build a context");

  assert.ok(
    ctx.strength > 0,
    `the euro leg must outweigh a sterling move twice its size, got ${ctx.strength}`,
  );
  const leader = require_(ctx.legs[0], "a context must name its biggest contributor");
  assert.equal(leader.symbol, "EURUSD", "the biggest contributor is cited first");
});

test("one pair is not an index", () => {
  // A single leg restated as "the dollar" would launder one pair's own move
  // into macro confirmation for every other symbol on the screen.
  assert.equal(buildDollarContext({ EURUSD: pair(1.08, -1) }), null, "one leg is not a basket");
  assert.equal(buildDollarContext({}), null, "no legs is not a basket");
  assert.ok(
    buildDollarContext({ GBPUSD: pair(1.27, -1), USDJPY: pair(151.4, 1) }),
    "two independent currencies is thin but real",
  );
});

test("a leg without the full window is dropped, not measured over a shorter one", () => {
  // A three-day euro move and a five-day yen move do not belong in the same
  // weighted average. Silently shortening the window for whichever series came
  // back thin would make the index quietly incomparable week to week.
  const series = basket(-5, -1, 1);
  series.EURUSD = pair(1.08, -5, DOLLAR_LOOKBACK - 5);

  const ctx = require_(buildDollarContext(series), "the two full legs still make a context");
  assert.equal(ctx.legs.length, 2, "the short leg must be dropped");
  assert.ok(
    ctx.legs.every((leg) => leg.symbol !== "EURUSD"),
    `EURUSD had too little history, got legs ${ctx.legs.map((l) => l.symbol).join(",")}`,
  );
});

test("a pair is never graded against an index it dominates", () => {
  // The euro alone is 58% of the DXY. Scoring a EURUSD setup against a proxy
  // that EURUSD mostly *is* would dress the pair's own move up as independent
  // macro confirmation — worse than having no macro read at all, because it
  // looks like evidence.
  const series = basket(-2, 1, -1);

  const all = require_(buildDollarContext(series), "the full basket must build");
  const withoutEur = require_(
    buildDollarContext(series, { exclude: "EURUSD" }),
    "two remaining legs must still build",
  );

  assert.equal(all.move, "strengthening", "the euro leg carries the full basket upward");
  assert.equal(
    withoutEur.move,
    "weakening",
    `without its own leg the reading must flip, got ${withoutEur.move} at ${withoutEur.strength}`,
  );
  assert.ok(
    withoutEur.legs.every((leg) => leg.symbol !== "EURUSD"),
    "the excluded pair must not appear in the evidence either",
  );

  // And what is left still has to be a whole: a basket whose shares sum to 0.26
  // would report a quarter of the move it actually measured.
  const shares = withoutEur.legs.reduce((sum, leg) => sum + leg.weight, 0);
  assert.ok(
    Math.abs(shares - 1) < 1e-3,
    `the surviving legs must renormalise to a full basket, got ${shares}`,
  );
});

test("legs pulling against each other lower the agreement", () => {
  // Strength says how far the dollar moved; agreement says whether the move is
  // one thing happening or one currency's story. They have to be separate, or
  // a 2% euro slide with sterling and the yen flatly disagreeing would read
  // exactly like a broad dollar bid.
  const unanimous = require_(buildDollarContext(basket(-1, -1, 1)), "unanimous basket");
  const split = require_(buildDollarContext(basket(-1, 1, -1)), "split basket");

  assert.equal(unanimous.agreement, 100);
  assert.ok(split.strength > 0, "the fixture must still net out dollar-positive");
  assert.ok(
    split.agreement < 100,
    `two legs disagreeing must show up as less than full agreement, got ${split.agreement}`,
  );
  assert.ok(
    split.agreement > 50,
    `the euro leg alone is still most of the basket, got ${split.agreement}`,
  );
});

test("a move inside the window's own noise reads flat, not weakly directional", () => {
  // A tenth of a percent over five days is Tuesday. Reporting it as a direction
  // would put a macro headwind line on a setup page every single day, and a
  // warning that always fires is a warning nobody reads.
  const ctx = require_(buildDollarContext(basket(-0.1, -0.1, 0.1)), "the basket must still build");

  assert.equal(ctx.move, "flat", `a 0.1% drift must read flat, got ${ctx.move} at ${ctx.strength}`);
  assert.equal(ctx.facts[0]?.key, "dollar.fact.flat", "the prose must match the reading");

  const read = require_(dollarAlignment("XAUUSD", "long", ctx), "gold has a dollar leg");
  assert.equal(read.stance, "neutral");
  assert.equal(read.score, 50, "a flat dollar is neither credit nor penalty");
});

// ------------------------------------------------------------- alignment

test("one dollar move is a tailwind for one instrument and a headwind for another", () => {
  // The same backdrop, read four ways. This is the only thing the component is
  // for: gold and USDJPY are opposite sides of the identical bet.
  const ctx = require_(buildDollarContext(basket(-1, -1, 1)), "a strong unanimous basket");
  assert.equal(ctx.move, "strengthening");

  const goldLong = require_(dollarAlignment("XAUUSD", "long", ctx), "gold long");
  const goldShort = require_(dollarAlignment("XAUUSD", "short", ctx), "gold short");
  const yenLong = require_(dollarAlignment("USDJPY", "long", ctx), "USDJPY long");
  const euroLong = require_(dollarAlignment("EURUSD", "long", ctx), "EURUSD long");

  assert.equal(goldLong.stance, "headwind", "buying gold into a rising dollar is swimming upstream");
  assert.equal(goldShort.stance, "tailwind", "the same backdrop favours the other side");
  assert.equal(yenLong.stance, "tailwind", "long USDJPY is long the dollar");
  assert.equal(euroLong.stance, "headwind", "long EURUSD is short the dollar");

  assert.ok(goldLong.score < 50, `a headwind must score below neutral, got ${goldLong.score}`);
  assert.ok(goldShort.score > 50, `a tailwind must score above neutral, got ${goldShort.score}`);
});

test("a split or shallow move barely moves the component off neutral", () => {
  // The backdrop is allowed to tilt a decision, never to make one. Only a
  // full-scale move every leg agrees with earns the extremes; anything less
  // has to stay close to 50, or a macro guess starts outvoting the structure
  // read the setup is actually built on.
  const strong = require_(buildDollarContext(basket(-1.5, -1.5, 1.5)), "a full-scale unanimous basket");
  const weak = require_(buildDollarContext(basket(-1, 1, -1)), "a split basket");

  const strongRead = require_(dollarAlignment("XAUUSD", "long", strong), "gold long vs strong dollar");
  const weakRead = require_(dollarAlignment("XAUUSD", "long", weak), "gold long vs split dollar");

  assert.equal(strongRead.stance, "headwind");
  assert.equal(weakRead.stance, "headwind", "the fixture must point the same way, only less so");
  assert.ok(
    strongRead.score < weakRead.score,
    `a unanimous move (${strongRead.score}) must bite harder than a split one (${weakRead.score})`,
  );
  assert.ok(
    Math.abs(weakRead.score - 50) <= 10,
    `a split, shallow dollar must stay near neutral, got ${weakRead.score}`,
  );
});

test("an instrument with no dollar leg is omitted, not scored neutral", () => {
  // Same principle as key-level confluence: being uninformed must not cost the
  // same as being measured and found wanting. A neutral 50 still drags a
  // high-scoring setup down once it is averaged in.
  const ctx = require_(buildDollarContext(basket(-1, -1, 1)), "a basket");

  assert.equal(dollarAlignment("EURGBP", "long", ctx), null, "a cross has nothing to read");
  assert.equal(dollarAlignment("XAUUSD", "none", ctx), null, "no direction is no bet");
  assert.equal(dollarAlignment("XAUUSD", "long", null), null, "no basket is no reading");
});

// --------------------------------------------------------------- scoring

/**
 * A middling setup on purpose. The dollar component is 4% of the model, so a
 * fixture already scoring in the eighties has no room left above it and the
 * tailwind case would pass or fail on a rounding boundary rather than on the
 * behaviour being tested.
 */
const alignedMtf: MtfAlignment = {
  legs: [
    { timeframe: "4h", trend: "bullish", phase: "continuation" },
    { timeframe: "1h", trend: "bullish", phase: "continuation" },
    { timeframe: "15m", trend: "weak_bullish", phase: "weakening" },
    { timeframe: "5m", trend: "weak_bullish", phase: "consolidation" },
  ],
  agreement: 70,
  conflict: null,
};
const cleanPullback: PullbackReading = { verdict: "pullback", strength: 60, reasons: [] };

function zone(overrides: Partial<SupplyDemandZone> = {}): SupplyDemandZone {
  return {
    id: "z",
    kind: "demand",
    timeframe: "15m",
    top: 110,
    bottom: 100,
    createdIndex: 10,
    createdTime: START,
    freshness: "fresh",
    tests: 0,
    reactionStrength: 80,
    structuralImpact: "caused_bos",
    htfAligned: true,
    score: 70,
    displacement: 1.8,
    timeInZone: 3,
    distanceTravelled: 4,
    invalidated: false,
    ...overrides,
  };
}

function quality(dollar: DollarAlignment | null) {
  return scoreSetup({
    zone: zone(),
    htfTrend: "bullish",
    mtf: alignedMtf,
    pullback: cleanPullback,
    regime: "trending_up",
    riskReward: 2,
    pendingConfirmations: 0,
    direction: "long",
    confluence: { score: 50, levels: [], facts: [] },
    dollar,
  });
}

test("a ninth component takes its share from the others rather than adding to the total", () => {
  const withoutDollar = quality(null);
  const withDollar = quality({ stance: "tailwind", score: 100, conviction: 80 });

  assert.equal(withoutDollar.components.length, 8, "confluence but no dollar");
  assert.equal(withDollar.components.length, 9, "the dollar must be a visible component");

  const total = withDollar.components.reduce((sum, c) => sum + c.weight, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `weights must still sum to 1, got ${total}`);
  const percents = withDollar.components.reduce((sum, c) => sum + Math.round(c.weight * 100), 0);
  assert.equal(percents, 100, `displayed percentages must add to 100, got ${percents}`);

  // The dilution claim itself: the zone's share has to shrink to make room. If
  // it does not, the new component was bolted on top and every grade printed
  // before today means something different from the ones printed after.
  const zoneShare = (q: ReturnType<typeof quality>): number =>
    q.components.find((c) => c.key === "zone")?.weight ?? 0;
  assert.ok(
    zoneShare(withDollar) < zoneShare(withoutDollar),
    `the zone's share must shrink: ${zoneShare(withoutDollar)} -> ${zoneShare(withDollar)}`,
  );
});

test("a setup with no dollar reading grades between one with a headwind and one with a tailwind", () => {
  // Being uninformed must sit strictly between measured-bad and measured-good.
  // The gaps are small — a few points either way — and that is the design: the
  // backdrop is allowed to tilt a grade, never to set one.
  const omitted = quality(null);
  const headwind = quality({ stance: "headwind", score: 0, conviction: 100 });
  const tailwind = quality({ stance: "tailwind", score: 100, conviction: 100 });

  assert.ok(
    headwind.score < omitted.score,
    `unknown (${omitted.score}) must not be graded as known-bad (${headwind.score})`,
  );
  assert.ok(
    omitted.score < tailwind.score,
    `a measured tailwind (${tailwind.score}) must beat no reading at all (${omitted.score})`,
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

function goldRun(peers?: Partial<Record<string, Candle[]>>) {
  const base = generateCandles({ symbol: "XAUUSD", timeframe: "15m", limit: 800, endTime: START }, { seed: 5 });
  return analyze({
    asset: requireAsset("XAUUSD"),
    candles: { "5m": base, "15m": base, "1h": aggregate(base, 4), "4h": aggregate(base, 16) },
    entryTimeframe: "15m",
    dataStatus: { quality: "LIVE", provider: "test", lastCandleTime: START, candleCount: base.length },
    now: START,
    ...(peers ? { peers } : {}),
  });
}

test("the engine grades gold against the dollar legs it was handed, and omits them when it is not", () => {
  const withPeers = goldRun(basket(-1, -1, 1));
  const without = goldRun();

  const ctx: DollarContext = require_(withPeers.dollar, "peers must produce a dollar reading");
  assert.equal(ctx.move, "strengthening");
  assert.equal(without.dollar, null, "no peers means no reading, not a neutral one");

  const setup = require_(
    withPeers.setups.find((s) => s.zone !== null),
    "the fixture must produce at least one zone-backed setup",
  );
  const component = require_(
    setup.quality.components.find((c) => c.key === "dollar"),
    "a zone-backed setup must be graded on the dollar backdrop",
  );

  // The graded number has to be the one derived from the context the result
  // reports, not a second reading computed somewhere else — otherwise the
  // breakdown cites a backdrop the grade was not built from.
  const expected = require_(
    dollarAlignment("XAUUSD", setup.direction, ctx),
    "gold always has a dollar leg",
  );
  assert.equal(component.score, expected.score, "the graded score must be the reported context's");

  const bare = require_(
    without.setups.find((s) => s.zone !== null),
    "the peerless run must produce a comparable setup",
  );
  assert.equal(
    bare.quality.components.find((c) => c.key === "dollar"),
    undefined,
    "without peers the component must be absent, not zeroed",
  );
});

process.stdout.write(`\ndollar.test.ts: ${passed} passed\n`);
