import type {
  Candle,
  MarketRegime,
  MtfAlignment,
  Phrase,
  PullbackReading,
  StructureReading,
  Timeframe,
  TrendState,
} from "@atc/types";
import { MTF_CHAIN } from "@atc/types";
import { atrAt, candleMetrics, clamp, highestHigh, lowestLow, volumeAverage } from "./indicators";
import { TREND_DIRECTION, trendAgreement } from "./structure";
import { p, trendPhrase } from "./phrases";

export function detectRegime(candles: Candle[], structure: StructureReading): MarketRegime {
  const last = candles.length - 1;
  if (last < 30) return "ranging";

  const atrNow = atrAt(candles, last);
  const atrPast = atrAt(candles.slice(0, last - 19), last - 20);
  const volRatio = atrPast > 0 ? atrNow / atrPast : 1;

  const range = highestHigh(candles, last - 20, last) - lowestLow(candles, last - 20, last);
  const rangeAtr = atrNow > 0 ? range / atrNow : 0;

  const direction = TREND_DIRECTION[structure.trend];

  if (volRatio >= 1.8) return "high_volatility";
  if (volRatio <= 0.5) return "low_volatility";
  if (rangeAtr >= 14 && structure.phase === "expansion") return "expansion";
  if (rangeAtr <= 6) return "compression";
  if (direction === "bullish") return "trending_up";
  if (direction === "bearish") return "trending_down";
  return "ranging";
}

export interface PullbackInput {
  candles: Candle[];
  structure: StructureReading;
  /** Direction of the higher-timeframe bias the pullback is measured against. */
  htfDirection: "bullish" | "bearish" | "neutral";
}

/**
 * Pullback vs reversal. A pullback retraces inside the prior leg without breaking
 * structure against the bias; a reversal breaks it with displacement.
 */
export function classifyPullback(input: PullbackInput): PullbackReading {
  const { candles, structure, htfDirection } = input;
  const last = candles.length - 1;
  const lastCandle = candles[last];
  const reasons: Phrase[] = [];

  if (!lastCandle || last < 20 || htfDirection === "neutral") {
    return { verdict: "unclear", strength: 0, reasons: [p("pullback.noDirection")] };
  }

  const high = structure.lastSwingHigh;
  const low = structure.lastSwingLow;
  if (!high || !low) {
    return { verdict: "unclear", strength: 0, reasons: [p("pullback.notEnoughSwings")] };
  }

  const legHigh = Math.max(high.price, low.price);
  const legLow = Math.min(high.price, low.price);
  const legSize = legHigh - legLow;
  if (legSize <= 0) {
    return { verdict: "unclear", strength: 0, reasons: [p("pullback.noLegSize")] };
  }

  const retrace =
    htfDirection === "bullish"
      ? (legHigh - lastCandle.close) / legSize
      : (lastCandle.close - legLow) / legSize;

  let score = 50;

  const percent = Number((retrace * 100).toFixed(0));

  if (retrace >= 0.236 && retrace <= 0.786) {
    score += 20;
    reasons.push(p("pullback.inBand", { percent }));
  } else if (retrace > 1) {
    score -= 35;
    reasons.push(p("pullback.erased", { percent }));
  } else if (retrace > 0.786) {
    score -= 15;
    reasons.push(p("pullback.deep", { percent }));
  } else {
    score -= 5;
    reasons.push(p("pullback.shallow", { percent }));
  }

  const counterShift = structure.events
    .slice(-3)
    .find((e) => (e.type === "MSS" || e.type === "CHOCH") && e.direction !== htfDirection);
  if (counterShift) {
    score -= counterShift.type === "MSS" ? 45 : 30;
    reasons.push(
      p("pullback.counterShift", {
        type: counterShift.type,
        displacement: counterShift.displacement,
      }),
    );
  } else {
    score += 15;
    reasons.push(p("pullback.noCounterShift"));
  }

  const corrective = correctiveStrength(candles, last, htfDirection);
  score += corrective.delta;
  reasons.push(corrective.reason);

  const strength = clamp(Math.round(score), 0, 100);
  const verdict = strength >= 60 ? "pullback" : strength <= 40 ? "reversal" : "unclear";
  return { verdict, strength, reasons };
}

function correctiveStrength(
  candles: Candle[],
  last: number,
  htfDirection: "bullish" | "bearish",
): { delta: number; reason: Phrase } {
  const atrValue = atrAt(candles, last);
  let counterBody = 0;
  let withBody = 0;
  let counterVolume = 0;
  let withVolume = 0;

  for (let i = Math.max(0, last - 5); i <= last; i++) {
    const c = candles[i];
    if (!c) continue;
    const m = candleMetrics(candles, i, atrValue);
    const against = htfDirection === "bullish" ? !m.bullish : m.bullish;
    if (against) {
      counterBody += m.bodyAtr;
      counterVolume += c.volume;
    } else {
      withBody += m.bodyAtr;
      withVolume += c.volume;
    }
  }

  const avgVolume = volumeAverage(candles, last, 20);
  const heavyCounterVolume = avgVolume > 0 && counterVolume > withVolume * 1.6;

  const body = Number(counterBody.toFixed(1));

  if (counterBody > 2.5) {
    return { delta: -25, reason: p("pullback.impulsiveCounter", { body }) };
  }
  if (heavyCounterVolume) {
    return { delta: -10, reason: p("pullback.heavyCounterVolume") };
  }
  if (counterBody <= 1.2 && withBody >= counterBody) {
    return { delta: 20, reason: p("pullback.correctiveCounter", { body }) };
  }
  return { delta: 0, reason: p("pullback.mixedCounter") };
}

/** Agreement across the mandatory 4H -> 1H -> 15M -> 5M chain. */
export function buildMtfAlignment(readings: Map<Timeframe, StructureReading>): MtfAlignment {
  const legs: MtfAlignment["legs"] = [];
  for (const tf of MTF_CHAIN) {
    const r = readings.get(tf);
    if (r) legs.push({ timeframe: tf, trend: r.trend, phase: r.phase });
  }

  if (legs.length < 2) {
    return { legs, agreement: 0, conflict: p("mtf.notEnoughTimeframes") };
  }

  let total = 0;
  let pairs = 0;
  let conflict: Phrase | null = null;
  for (let i = 0; i < legs.length - 1; i++) {
    const a = legs[i];
    const b = legs[i + 1];
    if (!a || !b) continue;
    const agreement = trendAgreement(a.trend, b.trend);
    total += agreement;
    pairs++;
    if (agreement === 0 && conflict === null) {
      conflict = p("mtf.conflict", {
        tfA: a.timeframe,
        trendA: trendPhrase(a.trend),
        tfB: b.timeframe,
        trendB: trendPhrase(b.trend),
      });
    }
  }

  return {
    legs,
    agreement: pairs > 0 ? Math.round(total / pairs) : 0,
    conflict,
  };
}

export function dominantDirection(readings: Map<Timeframe, StructureReading>): "bullish" | "bearish" | "neutral" {
  const htf = readings.get("4h") ?? readings.get("1d") ?? readings.get("1h");
  if (!htf) return "neutral";
  return TREND_DIRECTION[htf.trend];
}

/**
 * What this regime means for a pullback trader. Total over MarketRegime — every
 * regime has a note, so callers never have to check for an empty string.
 */
export function regimeNote(regime: MarketRegime): Phrase {
  return p(`regime.note.${regime}`);
}

export function trendLabel(trend: TrendState): Phrase {
  return trendPhrase(trend);
}
