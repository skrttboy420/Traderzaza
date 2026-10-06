import type {
  Candle,
  Phrase,
  StructureEvent,
  SupplyDemandZone,
  Timeframe,
  TrendState,
  ZoneFreshness,
  ZoneStructuralImpact,
} from "@atc/types";
import { atrAt, candleMetrics, clamp, highestHigh, lowestLow, volumeAverage } from "./indicators";
import { TREND_DIRECTION } from "./structure";
import { freshnessPhrase, impactPhrase, p, zoneKindPhrase } from "./phrases";

export interface ZoneOptions {
  /** Body size (ATR multiples) that qualifies a candle as an impulse. */
  impulseAtr: number;
  /** Max candles allowed in the base before the impulse. */
  maxBaseCandles: number;
  /** Candles after the impulse searched for a structural consequence. */
  impactWindow: number;
  /** Keep at most this many zones per side, highest score first. */
  maxPerSide: number;
}

export const DEFAULT_ZONE_OPTIONS: ZoneOptions = {
  impulseAtr: 0.9,
  maxBaseCandles: 5,
  impactWindow: 12,
  maxPerSide: 6,
};

export interface ZoneContext {
  symbol: string;
  timeframe: Timeframe;
  htfTrend: TrendState | null;
  events: StructureEvent[];
}

export function detectZones(
  candles: Candle[],
  context: ZoneContext,
  options: ZoneOptions = DEFAULT_ZONE_OPTIONS,
): SupplyDemandZone[] {
  const zones: SupplyDemandZone[] = [];
  const last = candles.length - 1;

  for (let i = 2; i <= last; i++) {
    const impulse = candles[i];
    if (!impulse) continue;
    const atrValue = atrAt(candles, i);
    const m = candleMetrics(candles, i, atrValue);
    if (m.bodyAtr < options.impulseAtr || m.bodyRatio < 0.55) continue;

    const base = findBase(candles, i, options.maxBaseCandles, atrValue);
    if (!base) continue;

    const kind = m.bullish ? "demand" : "supply";
    const top = highestHigh(candles, base.from, base.to);
    const bottom = lowestLow(candles, base.from, base.to);
    if (top <= bottom) continue;

    // Skip overlapping zones of the same kind — keep the newer, tighter base.
    const overlap = zones.find(
      (z) => z.kind === kind && z.top >= bottom && z.bottom <= top,
    );
    if (overlap) {
      if (top - bottom < overlap.top - overlap.bottom) {
        zones.splice(zones.indexOf(overlap), 1);
      } else {
        continue;
      }
    }

    const createdCandle = candles[base.from];
    if (!createdCandle) continue;

    const travel =
      kind === "demand"
        ? (highestHigh(candles, i, Math.min(last, i + options.impactWindow)) - top) / atrValue
        : (bottom - lowestLow(candles, i, Math.min(last, i + options.impactWindow))) / atrValue;

    const tests = countTests(candles, i + 1, last, top, bottom);
    const invalidated = isInvalidated(candles, i + 1, last, top, bottom, kind, atrValue);
    const impact = structuralImpact(context.events, i, options.impactWindow, kind);
    const volumeBoost = volumeAverage(candles, i, 1) / Math.max(volumeAverage(candles, i, 20), 1e-9);

    const reactionStrength = clamp(
      Math.round(
        clamp(m.bodyAtr / 2.5, 0, 1) * 40 +
          clamp(Math.max(travel, 0) / 4, 0, 1) * 30 +
          clamp(m.bodyRatio, 0, 1) * 15 +
          clamp((volumeBoost - 1) / 1.5, 0, 1) * 15,
      ),
      0,
      100,
    );

    const htfAligned =
      context.htfTrend === null
        ? false
        : (kind === "demand" && TREND_DIRECTION[context.htfTrend] === "bullish") ||
          (kind === "supply" && TREND_DIRECTION[context.htfTrend] === "bearish");

    const zone: SupplyDemandZone = {
      id: `${context.symbol}-${context.timeframe}-${kind}-${createdCandle.time}`,
      kind,
      timeframe: context.timeframe,
      top: Number(top.toFixed(8)),
      bottom: Number(bottom.toFixed(8)),
      createdIndex: base.from,
      createdTime: createdCandle.time,
      freshness: freshnessOf(tests, invalidated),
      tests,
      reactionStrength,
      structuralImpact: impact,
      htfAligned,
      score: 0,
      displacement: Number(m.bodyAtr.toFixed(2)),
      timeInZone: base.to - base.from + 1,
      distanceTravelled: Number(Math.max(travel, 0).toFixed(2)),
      invalidated,
    };
    zone.score = scoreZone(zone);
    zones.push(zone);
  }

  const demand = zones.filter((z) => z.kind === "demand").sort(byScore).slice(0, options.maxPerSide);
  const supply = zones.filter((z) => z.kind === "supply").sort(byScore).slice(0, options.maxPerSide);
  return [...demand, ...supply].sort((a, b) => b.createdTime - a.createdTime);
}

function byScore(a: SupplyDemandZone, b: SupplyDemandZone): number {
  return b.score - a.score;
}

/** The consolidation immediately before the impulse: small-bodied candles, at most `maxBase` of them. */
function findBase(
  candles: Candle[],
  impulseIndex: number,
  maxBase: number,
  atrValue: number,
): { from: number; to: number } | null {
  const to = impulseIndex - 1;
  if (to < 0) return null;
  let from = to;
  for (let i = to; i >= Math.max(0, to - maxBase + 1); i--) {
    const m = candleMetrics(candles, i, atrValue);
    if (m.bodyAtr > 0.7) break;
    from = i;
  }
  return { from, to };
}

/** Distinct touch events — consecutive candles inside the zone count as one test. */
function countTests(candles: Candle[], from: number, to: number, top: number, bottom: number): number {
  let tests = 0;
  let inside = false;
  for (let i = from; i <= to; i++) {
    const c = candles[i];
    if (!c) continue;
    const touching = c.low <= top && c.high >= bottom;
    if (touching && !inside) {
      tests++;
      inside = true;
    } else if (!touching) {
      inside = false;
    }
  }
  return tests;
}

function isInvalidated(
  candles: Candle[],
  from: number,
  to: number,
  top: number,
  bottom: number,
  kind: "demand" | "supply",
  atrValue: number,
): boolean {
  const buffer = atrValue * 0.1;
  for (let i = from; i <= to; i++) {
    const c = candles[i];
    if (!c) continue;
    if (kind === "demand" && c.close < bottom - buffer) return true;
    if (kind === "supply" && c.close > top + buffer) return true;
  }
  return false;
}

function freshnessOf(tests: number, invalidated: boolean): ZoneFreshness {
  if (invalidated) return "invalid";
  if (tests === 0) return "fresh";
  if (tests === 1) return "tested_once";
  if (tests === 2) return "tested_twice";
  if (tests <= 4) return "tested_multiple";
  return "weak";
}

function structuralImpact(
  events: StructureEvent[],
  impulseIndex: number,
  window: number,
  kind: "demand" | "supply",
): ZoneStructuralImpact {
  const wanted = kind === "demand" ? "bullish" : "bearish";
  const hit = events.find(
    (e) => e.index >= impulseIndex && e.index <= impulseIndex + window && e.direction === wanted,
  );
  if (!hit) return "none";
  if (hit.type === "MSS") return "caused_mss";
  if (hit.type === "CHOCH") return "caused_choch";
  if (hit.displacement >= 1.2) return "caused_bos";
  return "continuation";
}

const IMPACT_SCORE: Record<ZoneStructuralImpact, number> = {
  caused_mss: 100,
  caused_choch: 90,
  caused_bos: 80,
  strong_rejection: 65,
  continuation: 55,
  none: 25,
};

const FRESHNESS_SCORE: Record<ZoneFreshness, number> = {
  fresh: 100,
  tested_once: 75,
  tested_twice: 50,
  tested_multiple: 25,
  weak: 10,
  invalid: 0,
};

/**
 * 0-100 zone quality. This is a quality grade, never a win probability.
 */
export function scoreZone(zone: SupplyDemandZone): number {
  const parts = [
    { weight: 0.3, score: FRESHNESS_SCORE[zone.freshness] },
    { weight: 0.3, score: zone.reactionStrength },
    { weight: 0.25, score: IMPACT_SCORE[zone.structuralImpact] },
    { weight: 0.15, score: zone.htfAligned ? 100 : 35 },
  ];
  const raw = parts.reduce((sum, part) => sum + part.weight * part.score, 0);
  return clamp(Math.round(raw), 0, 100);
}

export function zoneMid(zone: SupplyDemandZone): number {
  return (zone.top + zone.bottom) / 2;
}

/** Distance from price to the nearest zone edge, in ATR multiples. 0 when price is inside. */
export function zoneDistanceAtr(zone: SupplyDemandZone, price: number, atrValue: number): number {
  const safeAtr = atrValue > 0 ? atrValue : 1;
  if (price >= zone.bottom && price <= zone.top) return 0;
  const raw = price > zone.top ? price - zone.top : zone.bottom - price;
  return Number((raw / safeAtr).toFixed(2));
}

export function priceInZone(zone: SupplyDemandZone, price: number): boolean {
  return price >= zone.bottom && price <= zone.top;
}

export function zoneFacts(zone: SupplyDemandZone): Phrase[] {
  return [
    p("zone.range", {
      tf: zone.timeframe,
      kind: zoneKindPhrase(zone.kind),
      bottom: zone.bottom,
      top: zone.top,
    }),
    p("zone.freshness", { freshness: freshnessPhrase(zone.freshness), tests: zone.tests }),
    p("zone.displacement", {
      displacement: zone.displacement,
      travelled: zone.distanceTravelled,
    }),
    p("zone.impact", { impact: impactPhrase(zone.structuralImpact) }),
    p("zone.htfAlignment", {
      alignment: p(zone.htfAligned ? "label.side.aligned" : "label.side.notAligned"),
    }),
    p("zone.score", { score: zone.score }),
  ];
}
