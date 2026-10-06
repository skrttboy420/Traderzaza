import type {
  Candle,
  Phrase,
  StructureEvent,
  StructureReading,
  Swing,
  SwingType,
  Timeframe,
  TrendPhase,
  TrendState,
} from "@atc/types";
import { atrAt, candleMetrics, clamp, highestHigh, lowestLow } from "./indicators";
import { biasPhrase, p, phasePhrase, trendPhrase } from "./phrases";

export interface StructureOptions {
  /** Candles required on each side of a pivot. Larger = fewer, more significant swings. */
  lookback: number;
  /** Minimum close-beyond distance (ATR multiples) for a break to count. */
  breakBuffer: number;
}

export const DEFAULT_STRUCTURE_OPTIONS: StructureOptions = {
  lookback: 3,
  breakBuffer: 0.05,
};

/** Fractal pivot detection. A swing high needs `lookback` lower highs on both sides. */
export function detectSwings(candles: Candle[], lookback = DEFAULT_STRUCTURE_OPTIONS.lookback): Swing[] {
  const raw: Swing[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    if (!c) continue;
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      const other = candles[j];
      if (!other) continue;
      if (other.high >= c.high) isHigh = false;
      if (other.low <= c.low) isLow = false;
    }
    if (isHigh) raw.push({ index: i, time: c.time, price: c.high, kind: "high", label: null });
    if (isLow) raw.push({ index: i, time: c.time, price: c.low, kind: "low", label: null });
  }
  raw.sort((a, b) => a.index - b.index);
  return labelSwings(alternate(raw));
}

/** Collapse consecutive same-kind pivots, keeping the most extreme one. */
function alternate(swings: Swing[]): Swing[] {
  const out: Swing[] = [];
  for (const s of swings) {
    const last = out[out.length - 1];
    if (!last) {
      out.push({ ...s });
      continue;
    }
    if (last.kind !== s.kind) {
      out.push({ ...s });
      continue;
    }
    const replace = s.kind === "high" ? s.price > last.price : s.price < last.price;
    if (replace) out[out.length - 1] = { ...s };
  }
  return out;
}

function labelSwings(swings: Swing[]): Swing[] {
  let lastHigh: Swing | null = null;
  let lastLow: Swing | null = null;
  return swings.map((s) => {
    let label: SwingType | null = null;
    if (s.kind === "high") {
      if (lastHigh) label = s.price > lastHigh.price ? "HH" : "LH";
      lastHigh = s;
    } else {
      if (lastLow) label = s.price > lastLow.price ? "HL" : "LL";
      lastLow = s;
    }
    return { ...s, label };
  });
}

/**
 * Break detection.
 * BOS  = break in the direction of the prevailing structure (continuation).
 * CHOCH = first break against the prevailing structure.
 * MSS  = a CHoCH confirmed by displacement, i.e. a real shift rather than a wick raid.
 */
export function detectStructureEvents(
  candles: Candle[],
  swings: Swing[],
  options: StructureOptions = DEFAULT_STRUCTURE_OPTIONS,
): StructureEvent[] {
  const events: StructureEvent[] = [];
  let bias: "bullish" | "bearish" | null = null;

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    if (!c) continue;
    const atrValue = atrAt(candles, i);
    const buffer = atrValue * options.breakBuffer;

    const priorHigh = lastSwingBefore(swings, i, "high");
    const priorLow = lastSwingBefore(swings, i, "low");

    const brokeUp = priorHigh !== null && c.close > priorHigh.price + buffer;
    const brokeDown = priorLow !== null && c.close < priorLow.price - buffer;
    if (!brokeUp && !brokeDown) continue;

    const direction: "bullish" | "bearish" = brokeUp ? "bullish" : "bearish";
    const broken = brokeUp ? priorHigh : priorLow;
    if (!broken) continue;
    if (events.some((e) => e.brokenSwingTime === broken.time && e.direction === direction)) continue;

    const metrics = candleMetrics(candles, i, atrValue);
    const displacement = metrics.bodyAtr;
    const against = bias !== null && bias !== direction;
    const type = against ? (displacement >= 1 ? "MSS" : "CHOCH") : "BOS";

    events.push({
      type,
      direction,
      index: i,
      time: c.time,
      price: c.close,
      brokenSwingTime: broken.time,
      displacement: Number(displacement.toFixed(2)),
    });
    bias = direction;
  }

  return events;
}

function lastSwingBefore(swings: Swing[], index: number, kind: "high" | "low"): Swing | null {
  let out: Swing | null = null;
  for (const s of swings) {
    if (s.index >= index) break;
    if (s.kind === kind) out = s;
  }
  return out;
}

export function classifyTrend(swings: Swing[], events: StructureEvent[]): TrendState {
  const labels = swings.filter((s) => s.label !== null).slice(-6);
  if (labels.length < 2) return "ranging";

  let bull = 0;
  let bear = 0;
  for (const s of labels) {
    if (s.label === "HH" || s.label === "HL") bull++;
    if (s.label === "LH" || s.label === "LL") bear++;
  }

  const recent = events.slice(-3);
  const lastEvent = recent[recent.length - 1];
  const shifted = recent.some((e) => e.type === "MSS" || e.type === "CHOCH");
  const bosRun = recent.filter((e) => e.type === "BOS");
  const alignedBos =
    bosRun.length >= 2 && bosRun.every((e) => e.direction === bosRun[0]?.direction);

  const score = bull - bear;

  if (shifted && Math.abs(score) <= 1) return "transition";
  if (score >= 3) {
    return alignedBos && lastEvent?.direction === "bullish" ? "strong_bullish" : "bullish";
  }
  if (score === 2) return "bullish";
  if (score === 1) return "weak_bullish";
  if (score <= -3) {
    return alignedBos && lastEvent?.direction === "bearish" ? "strong_bearish" : "bearish";
  }
  if (score === -2) return "bearish";
  if (score === -1) return "weak_bearish";
  return "ranging";
}

export function classifyPhase(candles: Candle[], swings: Swing[], events: StructureEvent[]): TrendPhase {
  const last = candles.length - 1;
  if (last < 20) return "consolidation";

  const atrNow = atrAt(candles, last);
  const atrBefore = atrAt(candles.slice(0, Math.max(20, last - 20)), Math.max(19, last - 21));
  const volRatio = atrBefore > 0 ? atrNow / atrBefore : 1;

  const recentRange = highestHigh(candles, last - 20, last) - lowestLow(candles, last - 20, last);
  const compression = atrNow > 0 ? recentRange / (atrNow * 20) : 1;

  const lastEvent = events[events.length - 1];
  if (lastEvent && (lastEvent.type === "MSS" || lastEvent.type === "CHOCH") && last - lastEvent.index <= 10) {
    return "reversal_risk";
  }

  if (volRatio >= 1.5) return "expansion";
  if (volRatio <= 0.6 || compression <= 0.25) return "compression";

  const labels = swings.filter((s) => s.label !== null).slice(-4);
  const weakening =
    labels.length >= 2 &&
    ((labels.filter((s) => s.label === "HH").length > 0 && labels[labels.length - 1]?.label === "LH") ||
      (labels.filter((s) => s.label === "LL").length > 0 && labels[labels.length - 1]?.label === "HL"));
  if (weakening) return "weakening";

  if (lastEvent && lastEvent.type === "BOS" && last - lastEvent.index <= 15) return "continuation";
  return "consolidation";
}

export const TREND_DIRECTION: Record<TrendState, "bullish" | "bearish" | "neutral"> = {
  strong_bullish: "bullish",
  bullish: "bullish",
  weak_bullish: "bullish",
  ranging: "neutral",
  transition: "neutral",
  weak_bearish: "bearish",
  bearish: "bearish",
  strong_bearish: "bearish",
};

export const TREND_STRENGTH: Record<TrendState, number> = {
  strong_bullish: 100,
  bullish: 75,
  weak_bullish: 50,
  ranging: 25,
  transition: 25,
  weak_bearish: 50,
  bearish: 75,
  strong_bearish: 100,
};

export function readStructure(
  candles: Candle[],
  timeframe: Timeframe,
  options: StructureOptions = DEFAULT_STRUCTURE_OPTIONS,
): StructureReading {
  const swings = detectSwings(candles, options.lookback);
  const events = detectStructureEvents(candles, swings, options);
  const trend = classifyTrend(swings, events);
  const phase = classifyPhase(candles, swings, events);

  const highs = swings.filter((s) => s.kind === "high");
  const lows = swings.filter((s) => s.kind === "low");
  const lastSwingHigh = highs[highs.length - 1] ?? null;
  const lastSwingLow = lows[lows.length - 1] ?? null;

  const facts: Phrase[] = [];
  const labelled = swings.filter((s) => s.label !== null).slice(-4);
  if (labelled.length > 0) {
    facts.push(
      p("structure.swingSequence", {
        tf: timeframe,
        sequence: labelled.map((s) => s.label).join(" → "),
      }),
    );
  }
  const lastEvent = events[events.length - 1];
  if (lastEvent) {
    facts.push(
      p("structure.lastEvent", {
        tf: timeframe,
        type: lastEvent.type,
        bias: biasPhrase(lastEvent.direction),
        price: lastEvent.price,
        displacement: lastEvent.displacement,
      }),
    );
  } else {
    facts.push(p("structure.noEvent", { tf: timeframe }));
  }
  if (lastSwingHigh) {
    facts.push(p("structure.lastSwingHigh", { tf: timeframe, price: lastSwingHigh.price }));
  }
  if (lastSwingLow) {
    facts.push(p("structure.lastSwingLow", { tf: timeframe, price: lastSwingLow.price }));
  }
  facts.push(
    p("structure.trendPhase", { tf: timeframe, trend: trendPhrase(trend), phase: phasePhrase(phase) }),
  );

  return { timeframe, swings, events, trend, phase, lastSwingHigh, lastSwingLow, facts };
}

/** 0-100 agreement between two trend reads. */
export function trendAgreement(a: TrendState, b: TrendState): number {
  const da = TREND_DIRECTION[a];
  const db = TREND_DIRECTION[b];
  if (da === db && da !== "neutral") {
    return clamp(100 - Math.abs(TREND_STRENGTH[a] - TREND_STRENGTH[b]) / 2, 50, 100);
  }
  if (da === "neutral" || db === "neutral") return 40;
  return 0;
}
