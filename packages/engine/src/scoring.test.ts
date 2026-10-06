import assert from "node:assert/strict";
import type { MtfAlignment, PullbackReading, SupplyDemandZone, Trade } from "@atc/types";
import { analysisConfidence, gradeOf, scoreSetup } from "./scoring";
import { scoreZone } from "./zones";
import { trendAgreement } from "./structure";
import { classifyTrade, detectPatterns, weeklyReport } from "./psychology";
import { diffForAlerts } from "./scanner";
import { p, renderPhrase } from "./phrases";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  process.stdout.write(`  ok ${name}\n`);
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
    score: 0,
    displacement: 1.8,
    timeInZone: 3,
    distanceTravelled: 4,
    invalidated: false,
    ...overrides,
  };
}

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

const conflictedMtf: MtfAlignment = {
  legs: [
    { timeframe: "4h", trend: "bullish", phase: "continuation" },
    { timeframe: "1h", trend: "bearish", phase: "reversal_risk" },
  ],
  agreement: 0,
  conflict: p("mtf.conflict", {
    tfA: "4h",
    trendA: p("label.trend.bullish"),
    tfB: "1h",
    trendB: p("label.trend.bearish"),
  }),
};

const cleanPullback: PullbackReading = { verdict: "pullback", strength: 80, reasons: [] };
const reversal: PullbackReading = { verdict: "reversal", strength: 20, reasons: [] };

test("zone score weights freshness, reaction, impact and HTF alignment", () => {
  const strong = scoreZone(zone());
  const stale = scoreZone(zone({ freshness: "tested_multiple", reactionStrength: 30, structuralImpact: "none" }));
  const broken = scoreZone(zone({ freshness: "invalid", invalidated: true, structuralImpact: "none", reactionStrength: 10, htfAligned: false }));
  assert.ok(strong > stale, "a fresh, impactful zone must outscore a stale one");
  assert.ok(stale > broken, "a stale zone must still outscore an invalidated one");
  assert.ok(strong <= 100 && broken >= 0);
});

test("setup quality component weights sum to 1", () => {
  const quality = scoreSetup({
    zone: zone({ score: 85 }),
    htfTrend: "bullish",
    mtf: alignedMtf,
    pullback: cleanPullback,
    regime: "trending_up",
    riskReward: 2.5,
    pendingConfirmations: 0,
    direction: "long",
  });
  const total = quality.components.reduce((sum, c) => sum + c.weight, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `weights must sum to 1, got ${total}`);
  assert.equal(quality.components.length, 7);
  assert.ok(
    quality.components.every((c) => renderPhrase(c.note, "th").length > 0),
    "every component needs an explanation",
  );
});

test("an aligned trend-pullback setup grades higher than a conflicted one", () => {
  const good = scoreSetup({
    zone: zone({ score: 90 }),
    htfTrend: "strong_bullish",
    mtf: alignedMtf,
    pullback: cleanPullback,
    regime: "trending_up",
    riskReward: 3,
    pendingConfirmations: 0,
    direction: "long",
  });
  const bad = scoreSetup({
    zone: zone({ score: 35, freshness: "weak" }),
    htfTrend: "bullish",
    mtf: conflictedMtf,
    pullback: reversal,
    regime: "compression",
    riskReward: 1.1,
    pendingConfirmations: 3,
    direction: "long",
  });
  assert.ok(good.score > bad.score, `${good.score} should beat ${bad.score}`);
  assert.equal(good.grade, "A");
  assert.equal(bad.grade, "D");
});

test("counter-trend direction is penalised on the HTF component", () => {
  const withTrend = scoreSetup({
    zone: zone({ score: 80 }),
    htfTrend: "bullish",
    mtf: alignedMtf,
    pullback: cleanPullback,
    regime: "trending_up",
    riskReward: 2,
    pendingConfirmations: 0,
    direction: "long",
  });
  const against = scoreSetup({
    zone: zone({ score: 80, kind: "supply" }),
    htfTrend: "bullish",
    mtf: alignedMtf,
    pullback: cleanPullback,
    regime: "trending_up",
    riskReward: 2,
    pendingConfirmations: 0,
    direction: "short",
  });
  const htfWith = withTrend.components.find((c) => c.key === "htf")?.score ?? 0;
  const htfAgainst = against.components.find((c) => c.key === "htf")?.score ?? 0;
  assert.ok(htfWith > htfAgainst);
  assert.equal(htfAgainst, 0);
});

test("no zone means a zero zone component and a low grade", () => {
  const quality = scoreSetup({
    zone: null,
    htfTrend: "ranging",
    mtf: conflictedMtf,
    pullback: { verdict: "unclear", strength: 0, reasons: [] },
    regime: "ranging",
    riskReward: 0,
    pendingConfirmations: 4,
    direction: "none",
  });
  assert.equal(quality.components.find((c) => c.key === "zone")?.score, 0);
  assert.equal(quality.grade, "D");
});

test("grade boundaries are stable", () => {
  assert.equal(gradeOf(80), "A");
  assert.equal(gradeOf(79), "B");
  assert.equal(gradeOf(65), "B");
  assert.equal(gradeOf(64), "C");
  assert.equal(gradeOf(50), "C");
  assert.equal(gradeOf(49), "D");
});

test("quality and confidence are independent scores", () => {
  const quality = scoreSetup({
    zone: zone({ score: 95 }),
    htfTrend: "strong_bullish",
    mtf: alignedMtf,
    pullback: cleanPullback,
    regime: "trending_up",
    riskReward: 3,
    pendingConfirmations: 0,
    direction: "long",
  });
  const confidence = analysisConfidence({
    dataStatus: { quality: "DEMO", provider: "mock", lastCandleTime: 0, candleCount: 400 },
    mtf: alignedMtf,
    pullback: cleanPullback,
    zone: zone(),
    candleCount: 400,
  });
  assert.ok(quality.score >= 80, "the setup itself is clean");
  assert.ok(confidence <= 60, "but demo data must keep confidence low");
});

test("live data with the full chain raises confidence", () => {
  const demo = analysisConfidence({
    dataStatus: { quality: "DEMO", provider: "mock", lastCandleTime: 0, candleCount: 400 },
    mtf: alignedMtf,
    pullback: cleanPullback,
    zone: zone(),
    candleCount: 400,
  });
  const live = analysisConfidence({
    dataStatus: { quality: "LIVE", provider: "binance", lastCandleTime: 0, candleCount: 400 },
    mtf: alignedMtf,
    pullback: cleanPullback,
    zone: zone(),
    candleCount: 400,
  });
  assert.ok(live > demo);
  assert.ok(live <= 95 && demo >= 5);
});

test("trend agreement is 0 for opposing directions and high for matching ones", () => {
  assert.equal(trendAgreement("bullish", "bearish"), 0);
  assert.equal(trendAgreement("bullish", "bullish"), 100);
  assert.ok(trendAgreement("strong_bullish", "weak_bullish") < 100);
  assert.equal(trendAgreement("ranging", "bullish"), 40);
});

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "t1",
    symbol: "XAUUSD",
    timeframe: "15m",
    direction: "long",
    entryType: "confirmation",
    entryPrice: 2650,
    stopLoss: 2640,
    takeProfits: [2670],
    size: 0.1,
    openedAt: 1700000000,
    closedAt: 1700003600,
    exitPrice: 2670,
    mfeR: 2,
    maeR: 0.4,
    resultR: 2,
    classification: null,
    psychology: [],
    setupId: null,
    notes: "",
    ...overrides,
  };
}

test("a loss with no linked setup is an emotional trade, not a valid loss", () => {
  const result = classifyTrade({ trade: trade({ resultR: -1, exitPrice: 2640 }), setup: null });
  assert.equal(result.classification, "emotional_trade");
});

test("a stop that was widened is flagged as moved_stop", () => {
  const result = classifyTrade({ trade: trade({ resultR: -1.8, maeR: 1.8, exitPrice: 2632 }), setup: null });
  assert.ok(result.tags.includes("moved_stop"));
  assert.equal(result.classification, "good_setup_bad_execution");
});

test("a winner that ran to 1.5R but closed flat is flagged as early break-even", () => {
  const result = classifyTrade({ trade: trade({ resultR: 0, mfeR: 2.1, exitPrice: 2650 }), setup: null });
  assert.ok(result.tags.includes("early_breakeven"));
});

test("revenge trading needs evidence of the sequence, not a guess", () => {
  const first = trade({ id: "a", resultR: -1, openedAt: 1000, closedAt: 2000, exitPrice: 2640 });
  const second = trade({ id: "b", resultR: -1, openedAt: 2300, closedAt: 3000, exitPrice: 2640, size: 0.3 });
  const patterns = detectPatterns({ trades: [first, second], from: 0, to: 10000 });
  assert.ok(patterns.some((p) => p.tag === "revenge"), "re-entry 5 minutes after a loss is revenge");
  assert.ok(patterns.some((p) => p.tag === "oversizing"), "tripling size after a loss is oversizing");
  for (const p of patterns) {
    assert.ok(p.evidence.length > 0, "a pattern without evidence must never be reported");
  }
});

test("an empty journal produces no behaviour claims", () => {
  const report = weeklyReport({ trades: [], from: 0, to: 10000 });
  assert.equal(report.patterns.length, 0);
  assert.ok(report.facts.some((f) => f.key === "psych.report.noPattern"));
});

test("alerts only fire on meaningful change", () => {
  const base = {
    id: "s1",
    symbol: "XAUUSD",
    timeframe: "15m" as const,
    direction: "long" as const,
    status: "IN_ZONE" as const,
    scannerState: "WAIT_CONFIRMATION" as const,
    regime: "trending_up" as const,
    quality: { score: 70, grade: "B" as const, components: [] },
    aiConfidence: 60,
    zone: zone(),
    pullback: cleanPullback,
    mtf: alignedMtf,
    plans: [],
    confirmationRequired: [],
    whyEnter: [],
    whyWait: [],
    invalidation: [p("alert.invalidatedZoneBroken")],
    facts: [],
    interpretation: [],
    assumptions: [],
    dataStatus: { quality: "LIVE" as const, provider: "binance", lastCandleTime: 0, candleCount: 400 },
    createdAt: 1,
    updatedAt: 2,
  };

  assert.equal(diffForAlerts([base], [{ ...base, quality: { ...base.quality, score: 72 } }]).length, 0);
  assert.equal(diffForAlerts([base], [{ ...base, quality: { ...base.quality, score: 90 } }]).length, 1);

  const promoted = diffForAlerts([base], [{ ...base, status: "ENTRY_VALID", scannerState: "ENTRY_NOW" }]);
  assert.equal(promoted.length, 1);
  assert.equal(promoted[0]?.kind, "state_change");

  const killed = diffForAlerts([base], [{ ...base, status: "INVALIDATED", scannerState: "NO_TRADE" }]);
  assert.equal(killed[0]?.kind, "invalidated");
});

process.stdout.write(`\nscoring.test.ts: ${passed} passed\n`);
