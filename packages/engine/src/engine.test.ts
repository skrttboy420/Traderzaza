import assert from "node:assert/strict";
import type { Candle } from "@atc/types";
import { generateCandles, requireAsset } from "@atc/market-data";
import { atrAt, candleMetrics, priceText } from "./indicators";
import { classifyTrend, detectStructureEvents, detectSwings, readStructure } from "./structure";
import { detectZones, priceInZone, zoneDistanceAtr } from "./zones";
import { analyze, isValidReEntry } from "./setups";
import { ReplayController, resolvePracticeCall } from "./replay";
import {
  breakEvenDecision,
  calculateRisk,
  excursion,
  resultR,
  structuralStop,
  summarizePerformance,
} from "./risk";
import { PHRASES, renderPhrase, trendPhrase, verdictPhrase } from "./phrases";

/** Narrative assertions key off the phrase id, which is language-independent. */
function hasKey(phrases: { key: string }[], key: string): boolean {
  return phrases.some((phrase) => phrase.key === key);
}

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  process.stdout.write(`  ok ${name}\n`);
}

function candle(time: number, open: number, high: number, low: number, close: number): Candle {
  return { time, open, high, low, close, volume: 1000 };
}

/**
 * Deterministic staircase: six up candles then four down candles, repeated.
 * Wicks are asymmetric so each leg ends on a clean fractal pivot instead of a
 * tie, which is what a real swing looks like.
 */
const LEG_PATTERN = [2, 1.6, 2.4, 1.2, 2.0, 1.8, -0.9, -1.3, -0.5, -0.8];

function uptrend(): Candle[] {
  const out: Candle[] = [];
  let price = 100;
  for (let i = 0; i < 130; i++) {
    const leg = LEG_PATTERN[i % LEG_PATTERN.length] ?? 1;
    const open = price;
    const close = price + leg;
    const upperWick = leg > 0 ? 0.4 : 0.08;
    const lowerWick = leg > 0 ? 0.15 : 0.3;
    out.push(
      candle(
        1700000000 + i * 900,
        open,
        Math.max(open, close) + upperWick,
        Math.min(open, close) - lowerWick,
        close,
      ),
    );
    price = close;
  }
  return out;
}

test("ATR is positive and finite on a real series", () => {
  const candles = uptrend();
  const value = atrAt(candles, candles.length - 1);
  assert.ok(value > 0, "ATR should be positive");
  assert.ok(Number.isFinite(value));
});

test("ATR never returns zero on a flat series", () => {
  const flat: Candle[] = Array.from({ length: 40 }, (_, i) => candle(1700000000 + i * 900, 50, 50, 50, 50));
  assert.ok(atrAt(flat, flat.length - 1) > 0, "fallback must keep ATR usable");
});

test("candle metrics measure body ratio and direction", () => {
  const candles = [candle(1, 10, 12, 9, 11.5)];
  const m = candleMetrics(candles, 0, 1);
  assert.equal(m.bullish, true);
  assert.ok(m.bodyRatio > 0.4 && m.bodyRatio <= 1);
});

test("swings alternate high/low and are labelled", () => {
  const swings = detectSwings(uptrend(), 3);
  assert.ok(swings.length >= 4, `expected swings, got ${swings.length}`);
  for (let i = 1; i < swings.length; i++) {
    assert.notEqual(swings[i]?.kind, swings[i - 1]?.kind, "swings must alternate");
  }
  assert.ok(swings.some((s) => s.label !== null), "at least one swing must be labelled");
});

test("an uptrend produces HH/HL labels and a bullish classification", () => {
  const candles = uptrend();
  const swings = detectSwings(candles, 3);
  const events = detectStructureEvents(candles, swings);
  const trend = classifyTrend(swings, events);
  const bullishLabels = swings.filter((s) => s.label === "HH" || s.label === "HL").length;
  const bearishLabels = swings.filter((s) => s.label === "LH" || s.label === "LL").length;
  assert.ok(bullishLabels > bearishLabels, "uptrend should print more HH/HL than LH/LL");
  assert.ok(trend.includes("bullish"), `expected a bullish trend, got ${trend}`);
});

test("structure events are bullish BOS in an uptrend", () => {
  const candles = uptrend();
  const events = detectStructureEvents(candles, detectSwings(candles, 3));
  assert.ok(events.length > 0, "expected at least one break");
  const bullish = events.filter((e) => e.direction === "bullish").length;
  assert.ok(bullish > events.length / 2, "most breaks should be bullish");
  assert.ok(events.every((e) => e.displacement >= 0));
});

test("structure reading exposes quotable facts", () => {
  const reading = readStructure(uptrend(), "15m");
  assert.ok(reading.facts.length >= 3);
  // Every structure fact must name the timeframe it came from. Checking the
  // `tf` variable rather than an English "15m:" prefix means the assertion
  // still holds once the fact is rendered in Thai.
  assert.ok(reading.facts.every((f) => f.vars?.tf === "15m"));
});

test("zones are detected with scores, freshness and bounded geometry", () => {
  const candles = generateCandles({ symbol: "XAUUSD", timeframe: "15m", limit: 400 });
  const reading = readStructure(candles, "15m");
  const zones = detectZones(candles, {
    symbol: "XAUUSD",
    timeframe: "15m",
    htfTrend: reading.trend,
    events: reading.events,
  });
  assert.ok(zones.length > 0, "demo data should contain zones");
  for (const z of zones) {
    assert.ok(z.top > z.bottom, "zone top must be above bottom");
    assert.ok(z.score >= 0 && z.score <= 100, "score must be 0-100");
    assert.ok(z.reactionStrength >= 0 && z.reactionStrength <= 100);
    assert.ok(["demand", "supply"].includes(z.kind));
    assert.ok(z.timeInZone >= 1);
  }
});

test("fresh zones score higher than invalidated ones", () => {
  const candles = generateCandles({ symbol: "BTCUSDT", timeframe: "15m", limit: 400 });
  const reading = readStructure(candles, "15m");
  const zones = detectZones(candles, {
    symbol: "BTCUSDT",
    timeframe: "15m",
    htfTrend: reading.trend,
    events: reading.events,
  });
  const fresh = zones.filter((z) => z.freshness === "fresh");
  const invalid = zones.filter((z) => z.freshness === "invalid");
  if (fresh.length > 0 && invalid.length > 0) {
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    assert.ok(avg(fresh.map((z) => z.score)) > avg(invalid.map((z) => z.score)));
  }
});

test("zone distance is zero inside the zone and positive outside", () => {
  const zone = {
    id: "z",
    kind: "demand" as const,
    timeframe: "15m" as const,
    top: 110,
    bottom: 100,
    createdIndex: 0,
    createdTime: 0,
    freshness: "fresh" as const,
    tests: 0,
    reactionStrength: 50,
    structuralImpact: "none" as const,
    htfAligned: true,
    score: 50,
    displacement: 1,
    timeInZone: 2,
    distanceTravelled: 2,
    invalidated: false,
  };
  assert.equal(priceInZone(zone, 105), true);
  assert.equal(zoneDistanceAtr(zone, 105, 2), 0);
  assert.equal(zoneDistanceAtr(zone, 120, 2), 5);
  assert.equal(zoneDistanceAtr(zone, 90, 2), 5);
});

test("analyze always returns at least one setup and never an empty explanation", () => {
  const asset = requireAsset("XAUUSD");
  const result = analyze({
    asset,
    candles: {
      "4h": generateCandles({ symbol: "XAUUSD", timeframe: "4h", limit: 300 }),
      "1h": generateCandles({ symbol: "XAUUSD", timeframe: "1h", limit: 300 }),
      "15m": generateCandles({ symbol: "XAUUSD", timeframe: "15m", limit: 400 }),
      "5m": generateCandles({ symbol: "XAUUSD", timeframe: "5m", limit: 400 }),
    },
    dataStatus: { quality: "DEMO", provider: "mock", lastCandleTime: 0, candleCount: 400 },
  });

  assert.ok(result.setups.length >= 1, "there must always be a setup, even if it is NO TRADE");
  assert.equal(result.mtf.legs.length, 4, "the full 4H/1H/15M/5M chain must be read");
  for (const setup of result.setups) {
    assert.ok(setup.facts.length > 0, "facts must never be empty");
    assert.ok(setup.interpretation.length > 0, "interpretation must never be empty");
    assert.ok(setup.assumptions.length > 0, "assumptions must never be empty");
    assert.ok(setup.whyWait.length > 0, "why wait must never be empty");
    assert.ok(setup.plans.length >= 1);
    assert.ok(setup.quality.score >= 0 && setup.quality.score <= 100);
    assert.ok(setup.aiConfidence >= 0 && setup.aiConfidence <= 100);
    if (setup.direction !== "none") {
      assert.ok(setup.whyEnter.length > 0, "a directional setup must explain why to enter");
      assert.ok(setup.invalidation.length > 0, "a directional setup must state invalidation");
    }
  }
});

test("demo data is reported as DEMO, never LIVE", () => {
  const asset = requireAsset("EURUSD");
  const result = analyze({
    asset,
    candles: { "15m": generateCandles({ symbol: "EURUSD", timeframe: "15m", limit: 300 }) },
    dataStatus: { quality: "DEMO", provider: "mock", lastCandleTime: 0, candleCount: 300 },
  });
  assert.equal(result.dataStatus.quality, "DEMO");
  assert.ok(result.setups.every((s) => s.dataStatus.quality === "DEMO"));
});

test("insufficient history is refused rather than guessed", () => {
  const asset = requireAsset("GBPUSD");
  const result = analyze({
    asset,
    candles: { "15m": generateCandles({ symbol: "GBPUSD", timeframe: "15m", limit: 20 }) },
    dataStatus: { quality: "DEMO", provider: "mock", lastCandleTime: 0, candleCount: 20 },
  });
  assert.ok(result.noTradeReasons.length > 0, "short history must produce a no-trade reason");
  assert.ok(hasKey(result.noTradeReasons, "noTrade.thinHistory"));
});

test("plans expose best price, safer price and a structural stop", () => {
  const asset = requireAsset("BTCUSDT");
  const result = analyze({
    asset,
    candles: {
      "4h": generateCandles({ symbol: "BTCUSDT", timeframe: "4h", limit: 300 }),
      "1h": generateCandles({ symbol: "BTCUSDT", timeframe: "1h", limit: 300 }),
      "15m": generateCandles({ symbol: "BTCUSDT", timeframe: "15m", limit: 400 }),
      "5m": generateCandles({ symbol: "BTCUSDT", timeframe: "5m", limit: 400 }),
    },
    dataStatus: { quality: "DEMO", provider: "mock", lastCandleTime: 0, candleCount: 400 },
  });

  const directional = result.setups.filter((s) => s.direction !== "none");
  for (const setup of directional) {
    const names = setup.plans.map((p) => p.name);
    assert.deepEqual(names, ["Conservative", "Balanced", "Aggressive"]);
    for (const plan of setup.plans) {
      assert.ok(plan.entryZone.high >= plan.entryZone.low);
      // Rendered, not just present: a key missing from the catalogue would
      // still be a non-empty Phrase object but would reach the user as "[key]".
      for (const locale of ["en", "th"] as const) {
        const reason = renderPhrase(plan.stopLossReason, locale);
        assert.ok(reason.length > 10, "a stop must always come with a reason");
        assert.ok(!reason.startsWith("["), `stop reason is untranslated in ${locale}`);
      }
      if (setup.direction === "long") {
        assert.ok(plan.stopLoss < plan.entryZone.high, "long stop must sit below the entry zone");
      } else {
        assert.ok(plan.stopLoss > plan.entryZone.low, "short stop must sit above the entry zone");
      }
    }
    const probe = setup.plans.find((p) => p.entryType === "probe");
    if (probe) assert.ok(probe.sizeFraction < 1, "a probe must be smaller than a full position");
  }
});

test("re-entry into the same zone is refused", () => {
  const asset = requireAsset("ETHUSDT");
  const result = analyze({
    asset,
    candles: {
      "4h": generateCandles({ symbol: "ETHUSDT", timeframe: "4h", limit: 300 }),
      "1h": generateCandles({ symbol: "ETHUSDT", timeframe: "1h", limit: 300 }),
      "15m": generateCandles({ symbol: "ETHUSDT", timeframe: "15m", limit: 400 }),
      "5m": generateCandles({ symbol: "ETHUSDT", timeframe: "5m", limit: 400 }),
    },
    dataStatus: { quality: "DEMO", provider: "mock", lastCandleTime: 0, candleCount: 400 },
  });
  const setup = result.setups.find((s) => s.zone !== null);
  if (setup) {
    const verdict = isValidReEntry(setup, setup);
    assert.equal(verdict.valid, false);
    assert.equal(verdict.reason.key, "reentry.no.sameZone");
  }
});

test("risk calculator sizes forex in lots and crypto in units", () => {
  const fx = calculateRisk({
    accountBalance: 10000,
    riskPercent: 1,
    entryPrice: 1.085,
    stopLoss: 1.08,
    asset: requireAsset("EURUSD"),
  });
  assert.equal(fx.unit, "lots");
  assert.equal(Math.round(fx.riskAmount), 100);
  assert.ok(fx.positionSize > 0 && fx.positionSize < 1);

  const crypto = calculateRisk({
    accountBalance: 10000,
    riskPercent: 1,
    entryPrice: 96000,
    stopLoss: 94000,
    asset: requireAsset("BTCUSDT"),
  });
  assert.equal(crypto.unit, "units");
  assert.equal(Number(crypto.positionSize.toFixed(3)), 0.05);
});

test("risk calculator warns instead of silently accepting a bad stop", () => {
  const same = calculateRisk({
    accountBalance: 10000,
    riskPercent: 1,
    entryPrice: 100,
    stopLoss: 100,
    asset: requireAsset("XAUUSD"),
  });
  assert.equal(same.positionSize, 0);
  assert.ok(hasKey(same.warnings, "risk.warn.stopEqualsEntry"));

  const oversized = calculateRisk({
    accountBalance: 10000,
    riskPercent: 5,
    entryPrice: 2650,
    stopLoss: 2640,
    asset: requireAsset("XAUUSD"),
  });
  assert.ok(hasKey(oversized.warnings, "risk.warn.riskPercentHigh"));
});

test("break-even requires 1R plus a new protected swing", () => {
  const tooEarly = breakEvenDecision({
    direction: "long",
    entryPrice: 100,
    stopLoss: 98,
    currentPrice: 101,
    newProtectedLevel: 100.5,
    atrValue: 1,
  });
  assert.equal(tooEarly.move, false);
  assert.equal(tooEarly.reason.key, "risk.be.notEnoughProgress");
  // The old test matched the string "0.50R"; the number itself is the point.
  assert.equal(tooEarly.reason.vars?.progress, 0.5);

  const noSwing = breakEvenDecision({
    direction: "long",
    entryPrice: 100,
    stopLoss: 98,
    currentPrice: 103,
    newProtectedLevel: null,
    atrValue: 1,
  });
  assert.equal(noSwing.move, false);
  assert.equal(noSwing.reason.key, "risk.be.noNewSwing");

  const valid = breakEvenDecision({
    direction: "long",
    entryPrice: 100,
    stopLoss: 98,
    currentPrice: 103,
    newProtectedLevel: 100.8,
    atrValue: 1,
  });
  assert.equal(valid.move, true);
  assert.ok((valid.price ?? 0) > 98, "the new stop must be tighter than the old one");
});

test("a label substituted into a noun slot is a noun phrase in both languages", () => {
  // Three sentences substitute {verdict} into a noun slot — "with {verdict}
  // into a zone", "แล้วเกิด{verdict} กลับเข้ามาหา", "ถูกจัดเป็น{verdict}" — and
  // one of the three labels was an adjectival form. It read fine in isolation
  // and broke every sentence it was substituted into, in both languages, which
  // is precisely the failure a per-key translation test cannot see: nothing is
  // missing, and the key renders. Only the grammatical *shape* is wrong.
  for (const verdict of ["pullback", "reversal", "unclear"] as const) {
    const th = renderPhrase(verdictPhrase(verdict), "th");
    const en = renderPhrase(verdictPhrase(verdict), "en");
    assert.ok(th.startsWith("การ"), `Thai verdict "${th}" must be a noun phrase (การ…)`);
    assert.ok(/^(a|an|the) /.test(en), `English verdict "${en}" must carry an article`);
  }

  // And the rendered sentence must not read as a clause jammed into a noun gap.
  const sentence = renderPhrase(
    { key: "setup.read.shape", vars: { trend: trendPhrase("bearish"), verdict: verdictPhrase("unclear"), tf: "15m", kind: { key: "label.zone.supply" } } },
    "th",
  );
  assert.ok(sentence.includes("แล้วเกิดการเคลื่อนไหวที่อ่านไม่ชัด กลับเข้ามาหา"), sentence);
});

test("a price inside a sentence is written at the instrument's own precision", () => {
  // Both of these sentences name a level in prose, and both used to hardcode
  // five decimals — so a gold swing high reached the trader as "2312.69788",
  // and a BTC level would have read "67000.00000". A typecheck cannot see it
  // and a screenshot of the wrong instrument hides it, so it is pinned here.
  assert.equal(priceText(2312.69788, requireAsset("XAUUSD").minTick), "2312.70");
  assert.equal(priceText(1.08234567, requireAsset("EURUSD").minTick), "1.08235");

  const gold = structuralStop(
    "short",
    2312.69788,
    8.85,
    { key: "label.side.swingHigh" },
    requireAsset("XAUUSD").minTick,
  );
  assert.equal(gold.reason.vars?.price, "2312.70");

  const be = breakEvenDecision({
    direction: "long",
    entryPrice: 1.08,
    stopLoss: 1.078,
    currentPrice: 1.0835,
    newProtectedLevel: 1.08123456,
    atrValue: 0.0008,
    minTick: requireAsset("EURUSD").minTick,
  });
  assert.equal(be.reason.vars?.level, "1.08123");
});

test("MFE/MAE and R are measured from the candles after entry", () => {
  const candles = [
    candle(10, 100, 104, 99, 103),
    candle(11, 103, 106, 102, 105),
    candle(12, 105, 105, 96, 97),
  ];
  const trade = { direction: "long" as const, entryPrice: 100, stopLoss: 98, openedAt: 10, closedAt: 12 };
  const ex = excursion(candles, trade);
  assert.equal(ex.mfeR, 3);
  assert.equal(ex.maeR, 2);
  assert.equal(resultR({ ...trade, exitPrice: 104 }), 2);
});

test("performance summary computes expectancy, profit factor and drawdown", () => {
  const base = {
    symbol: "XAUUSD",
    timeframe: "15m" as const,
    direction: "long" as const,
    entryType: "confirmation" as const,
    entryPrice: 100,
    stopLoss: 99,
    takeProfits: [102],
    size: 1,
    openedAt: 1,
    closedAt: 2,
    exitPrice: 102,
    mfeR: 2,
    maeR: 0.3,
    classification: null,
    psychology: [],
    setupId: null,
    notes: "",
  };
  const summary = summarizePerformance([
    { ...base, id: "1", resultR: 2 },
    { ...base, id: "2", resultR: -1 },
    { ...base, id: "3", resultR: -1 },
    { ...base, id: "4", resultR: 3 },
  ]);
  assert.equal(summary.trades, 4);
  assert.equal(summary.winRate, 50);
  assert.equal(summary.totalR, 3);
  assert.equal(summary.profitFactor, 2.5);
  assert.equal(summary.expectancyR, 0.75);
  assert.equal(summary.maxDrawdownR, 2);
});

test("replay never reveals candles beyond the cursor", () => {
  const candles = {
    "15m": generateCandles({ symbol: "XAUUSD", timeframe: "15m", limit: 300 }),
    "1h": generateCandles({ symbol: "XAUUSD", timeframe: "1h", limit: 300 }),
  };
  const replay = new ReplayController(candles, "15m", 120);
  const first = replay.visible();
  assert.equal(first["15m"]?.length, 121);
  const clock = replay.currentTime;
  assert.ok((first["1h"] ?? []).every((c) => c.time <= clock), "HTF must be truncated to the replay clock");

  replay.step(5);
  assert.equal(replay.visible()["15m"]?.length, 126);
  replay.reset(120);
  assert.equal(replay.current.cursor, 120);
  assert.equal(replay.current.playing, false);
});

test("a practice call that reaches the target settles at the target, not the close", () => {
  const forward = [
    candle(1000, 100, 101, 99.5, 100.5),
    candle(1900, 100.5, 104, 100.2, 103.5), // target 103 touched here
    candle(2800, 103.5, 106, 103, 105.5), // price kept running; we must not count it
  ];
  const out = resolvePracticeCall({
    direction: "long",
    entryPrice: 100,
    stopLoss: 98,
    takeProfit: 103,
    forward,
  });
  assert.ok(out);
  assert.equal(out.kind, "take_profit");
  assert.equal(out.exitPrice, 103);
  assert.equal(out.exitTime, 1900);
  assert.equal(out.barsHeld, 2);
  assert.equal(out.movePrice, 3);
  assert.equal(out.moveR, 1.5); // 3 points of reward on 2 points of risk
  assert.equal(out.ambiguous, false);
});

test("a practice call that is stopped out reports a negative R, not a smaller win", () => {
  const forward = [
    candle(1000, 100, 100.5, 97.5, 98), // stop 98 touched
    candle(1900, 98, 110, 98, 109), // a huge recovery the trade never saw
  ];
  const out = resolvePracticeCall({
    direction: "long",
    entryPrice: 100,
    stopLoss: 98,
    takeProfit: 106,
    forward,
  });
  assert.ok(out);
  assert.equal(out.kind, "stop_loss");
  assert.equal(out.exitPrice, 98);
  assert.equal(out.moveR, -1);
  assert.equal(out.barsHeld, 1);
});

test("a short call is scored in its own direction", () => {
  const forward = [candle(1000, 100, 100.4, 96, 96.5)];
  const out = resolvePracticeCall({
    direction: "short",
    entryPrice: 100,
    stopLoss: 102,
    takeProfit: 97,
    forward,
  });
  assert.ok(out);
  assert.equal(out.kind, "take_profit");
  assert.equal(out.movePrice, 3); // price fell 3, which is +3 for a short
  assert.equal(out.moveR, 1.5);
});

test("stop and target inside one candle is ambiguous and resolved against the trader", () => {
  // No tick sequence exists inside a candle, so guessing "target first" here
  // would be inventing a win.
  const forward = [candle(1000, 100, 104, 97, 103)];
  const out = resolvePracticeCall({
    direction: "long",
    entryPrice: 100,
    stopLoss: 98,
    takeProfit: 103,
    forward,
  });
  assert.ok(out);
  assert.equal(out.ambiguous, true);
  assert.equal(out.kind, "stop_loss");
  assert.equal(out.moveR, -1);
});

test("an unresolved practice call is marked window_close and still reports the move", () => {
  const forward = [candle(1000, 100, 101, 99.6, 100.8), candle(1900, 100.8, 101.5, 100.4, 101)];
  const out = resolvePracticeCall({
    direction: "long",
    entryPrice: 100,
    stopLoss: 98,
    takeProfit: 110,
    forward,
  });
  assert.ok(out);
  assert.equal(out.kind, "window_close");
  assert.equal(out.exitPrice, 101);
  assert.equal(out.movePrice, 1);
  assert.equal(out.moveR, 0.5);
  assert.equal(out.mfePrice, 1.5); // the 101.5 high
  assert.ok(out.maePrice < 0, "the dip below entry must be recorded as adverse");
});

test("a stay-out call still measures how far price actually travelled", () => {
  const forward = [candle(1000, 100, 103, 99.8, 102)];
  const out = resolvePracticeCall({
    direction: "none",
    entryPrice: 100,
    stopLoss: null,
    takeProfit: null,
    forward,
  });
  assert.ok(out);
  assert.equal(out.kind, "window_close");
  assert.equal(out.movePrice, 2);
  assert.equal(out.movePercent, 2);
  assert.equal(out.moveR, null, "with no stop there is no risk unit to divide by");
});

test("a practice call with no forward candles cannot be resolved", () => {
  assert.equal(
    resolvePracticeCall({
      direction: "long",
      entryPrice: 100,
      stopLoss: 98,
      takeProfit: 103,
      forward: [],
    }),
    null,
  );
});

test("no template repeats a word the label it interpolates already carries", () => {
  // The bug this guards: `confirm.pending.shift` read "รอ CHoCH หรือ BOS
  // ฝั่ง{bias}" while `label.bias.bearish` is "ฝั่งลง", so the screen printed
  // "ฝั่งฝั่งลง". Nothing in the type system can catch that — the key exists,
  // the var is supplied, the render succeeds. It is only wrong to a reader.
  //
  // So render every template against every label that could legally land in
  // each of its slots, and look at the junction: if the literal text before
  // the slot already ends with how the label begins, the word is doubled.
  const labelFamilies = new Map<string, string[]>();
  for (const [key, pair] of Object.entries(PHRASES) as [string, { en: string; th: string }][]) {
    const match = /^label\.(\w+)\./.exec(key);
    if (!match?.[1]) continue;
    const family = labelFamilies.get(match[1]) ?? [];
    family.push(pair.th);
    labelFamilies.set(match[1], family);
  }

  const problems: string[] = [];
  for (const [key, pair] of Object.entries(PHRASES) as [string, { en: string; th: string }][]) {
    for (const slot of pair.th.matchAll(/\{(\w+)\}/g)) {
      const varName = slot[1];
      if (!varName) continue;
      const candidates = labelFamilies.get(varName);
      if (!candidates) continue;

      // Literal text immediately before the slot, back to the previous slot.
      const before = pair.th.slice(0, slot.index).split("}").pop() ?? "";
      for (const label of candidates) {
        // Two characters is the shortest doubling worth reporting; a single
        // shared consonant happens by coincidence in Thai often enough.
        for (let len = label.length; len >= 2; len -= 1) {
          if (before.endsWith(label.slice(0, len))) {
            problems.push(`${key}: "...${before}" + "${label}" doubles "${label.slice(0, len)}"`);
            break;
          }
        }
      }
    }
  }

  assert.deepEqual(problems, [], `duplicated words in Thai templates:\n${problems.join("\n")}`);
});

process.stdout.write(`\nengine.test.ts: ${passed} passed\n`);
