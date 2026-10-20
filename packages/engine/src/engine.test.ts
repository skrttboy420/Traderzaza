import assert from "node:assert/strict";
import type { Candle, Trade } from "@atc/types";
import { generateCandles, requireAsset } from "@atc/market-data";
import { atrAt, candleMetrics, priceText } from "./indicators";
import { classifyTrend, detectStructureEvents, detectSwings, readStructure } from "./structure";
import { detectZones, priceInZone, zoneDistanceAtr } from "./zones";
import { analyze, isValidReEntry } from "./setups";
import { ReplayController, resolvePracticeCall } from "./replay";
import {
  breakEvenDecision,
  calculateRisk,
  dailyGuard,
  excursion,
  expectancy,
  EXPECTANCY_MIN_SAMPLE,
  maxAffordableStop,
  resultR,
  structuralStop,
  summarizePerformance,
} from "./risk";
import { readSessions } from "./sessions";
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

test("a size below the minimum lot is refused with a reason, never rounded into one", () => {
  // The small-account case, which is the common one rather than the exotic one:
  // $1,000 at 1% against a normal structural stop on gold. Rounding to two
  // decimals used to turn an exact 0.0076 into a tradable 0.01 — 1.32% risk on
  // a 1% instruction — and an exact 0.002 into 0.00, which slipped past a
  // `> 0` guard and returned no size and no explanation whatsoever.
  const gold = requireAsset("XAUUSD");

  const roundsUp = calculateRisk({
    accountBalance: 1000,
    riskPercent: 1,
    entryPrice: 4142.94,
    stopLoss: 4156.15,
    asset: gold,
  });
  assert.equal(roundsUp.positionSize, 0, "0.0076 must not be presented as a tradable 0.01");
  assert.ok(hasKey(roundsUp.warnings, "risk.warn.belowMinLot"));

  // The refusal has to be actionable, which means carrying the one number that
  // decides what to do next: what the smallest tradable lot would actually
  // cost. A 13.21-wide stop on gold risks $13.21 at 0.01 lots — 1.32% of a
  // $1,000 account against the 1% asked for. Without this the trader is told
  // the stop is "too wide for this account" and left to derive the rest.
  const refusal = roundsUp.warnings.find((w) => w.key === "risk.warn.belowMinLot");
  assert.deepEqual(refusal?.vars, {
    minLot: 0.01,
    minLotRisk: 13.21,
    minLotPercent: 1.32,
    riskPercent: 1,
  });

  const roundsToZero = calculateRisk({
    accountBalance: 1000,
    riskPercent: 1,
    entryPrice: 4142.94,
    stopLoss: 4192.94,
    asset: gold,
  });
  assert.equal(roundsToZero.positionSize, 0);
  assert.ok(
    hasKey(roundsToZero.warnings, "risk.warn.belowMinLot"),
    "a zero size must always carry its reason",
  );

  // The boundary itself stays tradable: a stop half as wide clears the minimum,
  // which is the actionable half of the answer — tighten the stop or the
  // account cannot take the trade.
  const affordable = calculateRisk({
    accountBalance: 1000,
    riskPercent: 1,
    entryPrice: 4142.94,
    stopLoss: 4147.94,
    asset: gold,
  });
  assert.equal(affordable.positionSize, 0.02);
  assert.equal(affordable.warnings.length, 0);
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

test("session windows follow the exchange's own clock, not a fixed UTC table", () => {
  // The same UTC half-hour, six months apart. In January London's desk is
  // still asleep; in July it has been open thirty minutes. Every retail
  // "London = 08:00-17:00 GMT" table gets one of these two wrong, and being an
  // hour out is what puts the overlap — the only window where a level is
  // tested by real size — in the wrong place.
  const winter = readSessions(new Date("2026-01-15T07:30:00Z"));
  const summer = readSessions(new Date("2026-07-15T07:30:00Z"));
  assert.equal(winter.active.includes("london"), false, "07:30 UTC in January is 07:30 in London");
  assert.equal(summer.active.includes("london"), true, "07:30 UTC in July is 08:30 in London");
});

test("the London/New York overlap is found in both halves of the year", () => {
  const winterOverlap = readSessions(new Date("2026-01-15T14:00:00Z"));
  assert.deepEqual(winterOverlap.active, ["london", "newYork"]);
  assert.equal(winterOverlap.overlap, true);
  assert.equal(winterOverlap.liquidity, "high");
  assert.equal(winterOverlap.note.key, "session.note.overlap");

  const summerOverlap = readSessions(new Date("2026-07-15T14:00:00Z"));
  assert.equal(summerOverlap.overlap, true);

  // 12:30 UTC is the discriminating hour: New York is at 07:30 in winter and
  // 08:30 in summer, so the overlap exists in one and not the other. A fixed
  // table cannot be right about both.
  assert.equal(readSessions(new Date("2026-01-15T12:30:00Z")).overlap, false);
  assert.equal(readSessions(new Date("2026-07-15T12:30:00Z")).overlap, true);

  // Minutes to close, read off the session's own clock. London sits at 14:00
  // and shuts at 17:00.
  const london = winterOverlap.sessions.find((s) => s.id === "london");
  assert.equal(london?.minutesToChange, 180);
});

test("thin hours are named as thin, and the weekend as closed", () => {
  // Tokyo alone. Price still moves here, which is the problem — this is the
  // state worth labelling, not a quiet one.
  const asiaOnly = readSessions(new Date("2026-01-15T02:00:00Z"));
  assert.deepEqual(asiaOnly.active, ["asia"]);
  assert.equal(asiaOnly.liquidity, "thin");
  assert.equal(asiaOnly.note.key, "session.note.asiaOnly");

  // New York has gone home, Tokyo opens at 09:00 JST — midnight UTC, two hours
  // out. Nothing is open and the gap says how long it lasts.
  const gap = readSessions(new Date("2026-01-15T22:00:00Z"));
  assert.deepEqual(gap.active, []);
  assert.equal(gap.fxClosed, false, "a Thursday evening is not the weekend");
  assert.equal(gap.liquidity, "thin");
  assert.deepEqual(gap.nextOpen, { id: "asia", minutes: 120 });

  // Saturday. Spot FX and metals are genuinely shut; crypto is not, which is
  // why this is a flag rather than a global "market closed".
  const weekend = readSessions(new Date("2026-01-17T12:00:00Z"));
  assert.equal(weekend.fxClosed, true);
  assert.equal(weekend.liquidity, "closed");
  assert.equal(weekend.note.key, "session.note.closed");
  // Tokyo opens 09:00 JST Monday = midnight UTC Monday, 36 hours on.
  assert.deepEqual(weekend.nextOpen, { id: "asia", minutes: 36 * 60 });
});

test("expectancy is reported in money per trade and per day actually traded", () => {
  const base = {
    symbol: "XAUUSD",
    timeframe: "15m" as const,
    direction: "long" as const,
    entryType: "confirmation" as const,
    entryPrice: 100,
    stopLoss: 99,
    takeProfits: [102],
    size: 1,
    exitPrice: 102,
    mfeR: 2,
    maeR: 0.3,
    classification: null,
    psychology: [],
    setupId: null,
    notes: "",
  };
  // Two trades on one UTC day, two on the next. 1R = $10.
  const DAY = 86_400;
  const trades = [
    { ...base, id: "1", openedAt: DAY * 100, closedAt: DAY * 100 + 3600, resultR: 2 },
    { ...base, id: "2", openedAt: DAY * 100, closedAt: DAY * 100 + 7200, resultR: -1 },
    { ...base, id: "3", openedAt: DAY * 101, closedAt: DAY * 101 + 3600, resultR: -1 },
    { ...base, id: "4", openedAt: DAY * 101, closedAt: DAY * 101 + 7200, resultR: 3 },
  ];

  const reading = expectancy(trades, 10);
  assert.equal(reading.totalR, 3);
  assert.equal(reading.perTradeMoney, 7.5, "0.75R expectancy at $10 per R");
  assert.equal(reading.totalMoney, 30);
  assert.equal(reading.tradingDays, 2);
  assert.equal(reading.perDayMoney, 15, "per day traded, not per day on the calendar");

  // Four trades cannot tell anyone whether a method works, and a headline that
  // says "$15 a day" off four samples is the most expensive lie this app could
  // tell. The sample size travels with the number.
  assert.equal(reading.confidence, "thin");
  assert.equal(reading.tradesNeeded, EXPECTANCY_MIN_SAMPLE - 4);

  // The offset is what keeps an evening session from being billed as two days.
  // Shifted far enough west, every one of these closes lands on the prior day.
  const shifted = expectancy(trades, 10, -12 * 60);
  assert.equal(shifted.tradingDays, 2, "a whole-day shift must not invent or merge days");
  assert.equal(shifted.perDayMoney, 15);

  // Both closes on day 100 sit at 01:00 and 02:00 UTC. An offset of -3h pulls
  // them back into day 99 — a real regrouping, and proof the offset is used
  // rather than accepted and ignored.
  const evening = expectancy(
    [
      { ...base, id: "1", openedAt: DAY * 100, closedAt: DAY * 100 + 3600, resultR: 2 },
      { ...base, id: "2", openedAt: DAY * 100, closedAt: DAY * 100 + 7200, resultR: -1 },
      { ...base, id: "3", openedAt: DAY * 100, closedAt: DAY * 100 + 20 * 3600, resultR: 2 },
    ],
    10,
    -3 * 60,
  );
  assert.equal(evening.tradingDays, 2, "two of these closes belong to the previous local day");

  const empty = expectancy([], 10);
  assert.equal(empty.confidence, "none");
  assert.equal(empty.perDayMoney, 0, "no trades must not divide by zero");
  assert.equal(empty.tradesNeeded, EXPECTANCY_MIN_SAMPLE);
});

test("the widest affordable stop is the inverse of the min-lot refusal", () => {
  const gold = requireAsset("XAUUSD");

  // $1,000 at 1% is $10 of risk. Gold's smallest lot costs $0.10 per pip, so
  // the account can pay for 100 pips — $10.00 of price, 1,000 points on a
  // retail platform. This is the number the trader actually asks for, and
  // until now the app could only answer it by refusing a trade already built.
  const widest = maxAffordableStop(1000, 1, gold);
  assert.equal(widest?.pips, 100);
  assert.equal(widest?.points, 1000);
  assert.equal(widest?.riskAmount, 10);

  // The two functions have to agree, or the app tells the trader a stop is
  // affordable on one screen and refuses it on the next. Just inside the
  // boundary sizes; just outside does not.
  const inside = calculateRisk({
    accountBalance: 1000,
    riskPercent: 1,
    entryPrice: 4000,
    stopLoss: 4000 - (widest?.distance ?? 0) * 0.99,
    asset: gold,
  });
  assert.ok(inside.positionSize >= 0.01, "a stop inside the limit must be sizeable");

  const outside = calculateRisk({
    accountBalance: 1000,
    riskPercent: 1,
    entryPrice: 4000,
    stopLoss: 4000 - (widest?.distance ?? 0) * 1.01,
    asset: gold,
  });
  assert.equal(outside.positionSize, 0, "a stop past the limit must be refused");
  assert.ok(hasKey(outside.warnings, "risk.warn.belowMinLot"));

  // Halving the balance halves the stop the account can carry. Obvious, and
  // worth pinning: this is the whole argument for trading a smaller market
  // rather than a tighter stop.
  assert.equal(maxAffordableStop(500, 1, gold)?.points, 500);

  // Crypto sizes in fractional units, so no lot minimum binds and there is no
  // such ceiling to report. Returning 0 here would read as "no stop is
  // affordable", which is the opposite of the truth.
  assert.equal(maxAffordableStop(1000, 1, requireAsset("BTCUSDT")), null);
  assert.equal(maxAffordableStop(0, 1, gold), null, "no balance, no answer");
});

/**
 * A day that starts at a known second, so "today" and "yesterday" in these
 * tests are exact rather than approximately now.
 */
const DAY_START = 1_760_000_000;
const HOUR = 3600;

/**
 * The guard reads three fields off a trade and nothing else, so the fixtures
 * carry three fields and nothing else. `id` is dropped deliberately: a fixture
 * that satisfies the real signature is a fixture that proves the signature is
 * narrow enough to be fed by a journal entry, a Supabase row, or anything else.
 */
type GuardTrade = Pick<Trade, "openedAt" | "closedAt" | "resultR">;

function closedTrade(resultR: number, openedAt: number, closedAt = openedAt + HOUR): GuardTrade {
  return { openedAt, closedAt, resultR };
}

function openTrade(openedAt: number): GuardTrade {
  return { openedAt, closedAt: null, resultR: null };
}

test("the daily guard stops the day at the loss limit and not before", () => {
  const limits = { maxDailyLossR: 2, maxTradesPerDay: 0, maxOpenPositions: 0 };

  // One full stop of a two-stop limit. Halfway is a caution, not a stop: a
  // trader told to quit after one loss would have no plan left by Tuesday.
  const halfway = dailyGuard({
    trades: [closedTrade(-1, DAY_START + HOUR)],
    dayStart: DAY_START,
    limits,
  });
  assert.equal(halfway.state, "caution");
  assert.equal(halfway.netR, -1);
  assert.equal(halfway.remainingR, 1);
  assert.ok(hasKey(halfway.reasons, "guard.caution.dailyLoss"));

  const atLimit = dailyGuard({
    trades: [closedTrade(-1, DAY_START + HOUR), closedTrade(-1, DAY_START + 2 * HOUR)],
    dayStart: DAY_START,
    limits,
  });
  assert.equal(atLimit.state, "stop");
  assert.equal(atLimit.remainingR, 0);
  const stop = atLimit.reasons.find((r) => r.key === "guard.stop.dailyLoss");
  assert.deepEqual(stop?.vars, { lossR: 2, limitR: 2 });

  // A win inside the day genuinely buys back room. The limit is on net damage
  // to the account, not on how many times the trader was wrong.
  const recovered = dailyGuard({
    trades: [
      closedTrade(-1, DAY_START + HOUR),
      closedTrade(-1, DAY_START + 2 * HOUR),
      closedTrade(1.5, DAY_START + 3 * HOUR),
    ],
    dayStart: DAY_START,
    limits,
  });
  assert.equal(recovered.netR, -0.5);
  assert.equal(recovered.state, "clear");
});

test("yesterday's losses do not spend today's limit", () => {
  // The bug this guards against is an off-by-one-day that makes the breaker
  // fire permanently: once the account is down 2R lifetime, every morning
  // opens closed. That is indistinguishable from a broken app, and the trader
  // learns to ignore the banner — which is the one failure mode that matters.
  const guard = dailyGuard({
    trades: [
      closedTrade(-1, DAY_START - 20 * HOUR, DAY_START - 19 * HOUR),
      closedTrade(-1, DAY_START - 18 * HOUR, DAY_START - 17 * HOUR),
      closedTrade(-1, DAY_START - 16 * HOUR, DAY_START - 15 * HOUR),
    ],
    dayStart: DAY_START,
    limits: { maxDailyLossR: 2, maxTradesPerDay: 3, maxOpenPositions: 2 },
  });
  assert.equal(guard.netR, 0, "yesterday's R must not count against today");
  assert.equal(guard.tradesToday, 0);
  assert.ok(!hasKey(guard.reasons, "guard.stop.dailyLoss"));

  // Tilt is the exception, and deliberately so: three losses in a row an hour
  // before midnight is the same trader an hour after it.
  assert.equal(guard.lossStreak, 3);
  assert.equal(guard.state, "caution");
  assert.ok(hasKey(guard.reasons, "guard.caution.lossStreak"));
});

test("trade count and open positions are enforced independently of R", () => {
  // Both settings existed in the UI and were read by nothing. A limit the app
  // displays but does not apply is worse than no limit, because the trader
  // believes something is watching.
  const overtraded = dailyGuard({
    trades: [
      closedTrade(1, DAY_START + HOUR),
      closedTrade(1, DAY_START + 2 * HOUR),
      closedTrade(1, DAY_START + 3 * HOUR),
    ],
    dayStart: DAY_START,
    limits: { maxDailyLossR: 2, maxTradesPerDay: 3, maxOpenPositions: 2 },
  });
  assert.equal(overtraded.netR, 3, "up on the day");
  assert.equal(overtraded.state, "stop", "a winning day still ends at the trade cap");
  assert.equal(overtraded.remainingTrades, 0);
  assert.ok(hasKey(overtraded.reasons, "guard.stop.tradeCount"));

  const piledUp = dailyGuard({
    trades: [
      openTrade(DAY_START + HOUR),
      openTrade(DAY_START + 2 * HOUR),
    ],
    dayStart: DAY_START,
    limits: { maxDailyLossR: 0, maxTradesPerDay: 0, maxOpenPositions: 2 },
  });
  assert.equal(piledUp.openPositions, 2);
  assert.equal(piledUp.state, "stop");
  assert.ok(hasKey(piledUp.reasons, "guard.stop.openPositions"));
  assert.equal(piledUp.remainingR, null, "no loss limit set means no number to report");
  assert.equal(piledUp.remainingTrades, null);
});

test("a day nothing has happened on says nothing", () => {
  // Every limit armed, no trades. An empty morning must produce an empty
  // banner: a warning shown unconditionally stops being read by the time it
  // has something to say.
  const quiet = dailyGuard({
    trades: [closedTrade(-1, DAY_START - 30 * HOUR, DAY_START - 29 * HOUR)],
    dayStart: DAY_START,
    limits: { maxDailyLossR: 2, maxTradesPerDay: 3, maxOpenPositions: 2 },
  });
  assert.equal(quiet.state, "clear");
  assert.deepEqual(quiet.reasons, []);

  const started = dailyGuard({
    trades: [closedTrade(1, DAY_START + HOUR)],
    dayStart: DAY_START,
    limits: { maxDailyLossR: 2, maxTradesPerDay: 3, maxOpenPositions: 2 },
  });
  assert.equal(started.state, "clear");
  const summary = started.reasons.find((r) => r.key === "guard.clear");
  assert.deepEqual(summary?.vars, { taken: 1, limit: 3, netR: 1 });
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

test("every phrase interpolates the same variables in both locales", () => {
  // The web dictionaries already assert this for the UI strings; the engine
  // catalogue is the other half of the same surface and had no equivalent
  // guard. It needs one more than the UI does, because there is no fallback
  // here: a `{minLotRisk}` present in `en` and misspelt in `th` renders the
  // literal braces to a Thai reader, and the number that was the whole point
  // of the sentence never appears. Every phrase that carries a figure — a
  // price, a risk percent, a lot size — fails silently and legibly wrong.
  const names = (template: string): string[] =>
    [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();

  const problems: string[] = [];
  for (const [key, pair] of Object.entries(PHRASES) as [string, { en: string; th: string }][]) {
    const en = names(pair.en);
    const th = names(pair.th);
    // Repeats are allowed and deliberate — a percentage worth stating twice in
    // one sentence reads better than a pronoun — so compare the sets.
    const enSet = [...new Set(en)].join(",");
    const thSet = [...new Set(th)].join(",");
    if (enSet !== thSet) problems.push(`${key}: en {${enSet}} vs th {${thSet}}`);
  }

  assert.deepEqual(problems, [], `variable mismatch between locales:\n${problems.join("\n")}`);
});

process.stdout.write(`\nengine.test.ts: ${passed} passed\n`);
