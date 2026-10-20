import type {
  DataStatus,
  MarketRegime,
  MtfAlignment,
  PullbackReading,
  ScoreComponent,
  SetupQuality,
  SupplyDemandZone,
  TrendState,
} from "@atc/types";
import { clamp } from "./indicators";
import { TREND_DIRECTION } from "./structure";
import type { ZoneConfluence } from "./levels";
import { levelPhrase } from "./levels";
import type { DollarAlignment } from "./dollar";
import { dollarStancePhrase } from "./dollar";
import {
  directionPhrase,
  freshnessPhrase,
  p,
  regimePhrase,
  trendPhrase,
  verdictPhrase,
  zoneKindPhrase,
} from "./phrases";

export interface QualityInput {
  zone: SupplyDemandZone | null;
  htfTrend: TrendState;
  mtf: MtfAlignment;
  pullback: PullbackReading;
  regime: MarketRegime;
  /** Best R:R across the generated plans. */
  riskReward: number;
  /** Count of confirmation conditions still outstanding. */
  pendingConfirmations: number;
  direction: "long" | "short" | "none";
  /**
   * Higher-timeframe key levels backing the zone. Optional: callers that have
   * no HTF series to aggregate from simply omit it and the component is not
   * scored at all, rather than being scored zero.
   */
  confluence?: ZoneConfluence | null;
  /**
   * How the dollar backdrop reads against this direction. Optional for the
   * same reason as `confluence`: an instrument with no dollar leg, or a caller
   * with no peer series, gets the component left out rather than scored.
   */
  dollar?: DollarAlignment | null;
}

/**
 * Raw component weights.
 *
 * The first seven sum to exactly 1.00 and are the original scoring model.
 * `confluence` and `dollar` are additive on top, and `scoreSetup` renormalises
 * the whole set when either is present — see the comment on `normaliseWeights`
 * for why that matters.
 *
 * Both extras are deliberately the smallest weight in the model. They are
 * context that tilts a decision, not a reason to take a trade: neither a round
 * number nor a dollar week should ever outvote the zone the setup is built on.
 */
const WEIGHTS = {
  zone: 0.25,
  htf: 0.2,
  mtf: 0.15,
  pullback: 0.15,
  confirmation: 0.1,
  riskReward: 0.1,
  regime: 0.05,
  confluence: 0.05,
  dollar: 0.05,
} as const;

/**
 * 0-100 Setup Quality Score.
 *
 * This grades how well the setup matches the trading plan. It is NOT a win
 * probability and must never be presented as one.
 */
export function scoreSetup(input: QualityInput): SetupQuality {
  const components: ScoreComponent[] = [];

  const zone = input.zone;
  components.push({
    key: "zone",
    label: p("score.label.zone"),
    weight: WEIGHTS.zone,
    score: zone ? zone.score : 0,
    note: zone
      ? p("score.note.zone", {
          kind: zoneKindPhrase(zone.kind),
          freshness: freshnessPhrase(zone.freshness),
          strength: zone.reactionStrength,
        })
      : p("score.note.noZone"),
  });

  const htfDirection = TREND_DIRECTION[input.htfTrend];
  const wanted = input.direction === "long" ? "bullish" : input.direction === "short" ? "bearish" : "neutral";
  const htfScore =
    input.direction === "none"
      ? 0
      : htfDirection === wanted
        ? trendScore(input.htfTrend)
        : htfDirection === "neutral"
          ? 35
          : 0;
  components.push({
    key: "htf",
    label: p("score.label.htf"),
    weight: WEIGHTS.htf,
    score: htfScore,
    note: p("score.note.htf", {
      trend: trendPhrase(input.htfTrend),
      direction: directionPhrase(input.direction),
    }),
  });

  components.push({
    key: "mtf",
    label: p("score.label.mtf"),
    weight: WEIGHTS.mtf,
    score: input.mtf.agreement,
    note: input.mtf.conflict ?? p("score.note.mtfClean", { agreement: input.mtf.agreement }),
  });

  const pullbackScore =
    input.pullback.verdict === "pullback"
      ? input.pullback.strength
      : input.pullback.verdict === "unclear"
        ? Math.min(input.pullback.strength, 45)
        : 0;
  components.push({
    key: "pullback",
    label: p("score.label.pullback"),
    weight: WEIGHTS.pullback,
    score: pullbackScore,
    note: p("score.note.pullback", {
      verdict: verdictPhrase(input.pullback.verdict),
      strength: input.pullback.strength,
    }),
  });

  const confirmationScore = clamp(100 - input.pendingConfirmations * 25, 0, 100);
  components.push({
    key: "confirmation",
    label: p("score.label.confirmation"),
    weight: WEIGHTS.confirmation,
    score: confirmationScore,
    note:
      input.pendingConfirmations === 0
        ? p("score.note.confirmationComplete")
        : p("score.note.confirmationPending", { count: input.pendingConfirmations }),
  });

  const rrScore = clamp(Math.round(((input.riskReward - 1) / 3) * 100), 0, 100);
  components.push({
    key: "riskReward",
    label: p("score.label.riskReward"),
    weight: WEIGHTS.riskReward,
    score: rrScore,
    note: p("score.note.riskReward", { rr: Number(input.riskReward.toFixed(2)) }),
  });

  const regimeScore = regimeFit(input.regime, input.direction);
  components.push({
    key: "regime",
    label: p("score.label.regime"),
    weight: WEIGHTS.regime,
    score: regimeScore,
    note: p("score.note.regime", { regime: regimePhrase(input.regime) }),
  });

  const confluence = input.confluence;
  if (confluence) {
    const strongest = confluence.levels[0];
    components.push({
      key: "confluence",
      label: p("score.label.confluence"),
      weight: WEIGHTS.confluence,
      score: confluence.score,
      note: strongest
        ? p("score.note.confluence", {
            level: levelPhrase(strongest.kind),
            price: strongest.price,
          })
        : p("score.note.noConfluence"),
    });
  }

  const dollar = input.dollar;
  if (dollar) {
    components.push({
      key: "dollar",
      label: p("score.label.dollar"),
      weight: WEIGHTS.dollar,
      score: dollar.score,
      note: p("score.note.dollar", {
        stance: dollarStancePhrase(dollar.stance),
        conviction: dollar.conviction,
      }),
    });
  }

  normaliseWeights(components);

  const raw = components.reduce((sum, c) => sum + c.weight * c.score, 0);
  const score = clamp(Math.round(raw), 0, 100);
  return { score, grade: gradeOf(score), components };
}

/**
 * Rescale component weights so they sum to 1.
 *
 * `ScoreComponent` documents that invariant, the UI prints each weight as a
 * percentage, and the score is the weighted mean — so a component bolted on
 * after the fact must *dilute* the others, not inflate the total. Without this,
 * adding `confluence` at 0.05 would have quietly moved an 80-point A-grade
 * threshold to 76 points of the old model plus a free 5, and every historical
 * grade in the journal would mean something different from the new ones.
 *
 * Mutating in place is deliberate: the components were just built here and
 * nothing else holds a reference yet.
 *
 * The shares are apportioned in whole percentage points by largest remainder,
 * not simply divided. `ScoreBreakdown` prints `Math.round(weight * 100)%` per
 * row, and the eight shares of 1/1.05 each round *up* to a set totalling 101% —
 * a breakdown that visibly does not add up undermines the one number it is
 * there to explain.
 * Rounding first and scoring from the rounded weights also means the
 * percentages on screen *are* the arithmetic that ran, rather than an
 * approximation of it.
 *
 * Ties go to the earlier component, which is arbitrary but deterministic: two
 * equal raw weights cannot both get the spare point.
 */
function normaliseWeights(components: ScoreComponent[]): void {
  const total = components.reduce((sum, c) => sum + c.weight, 0);
  if (total <= 0 || Math.abs(total - 1) < 1e-9) return;

  const exact = components.map((c) => (c.weight / total) * 100);
  const points = exact.map((v) => Math.floor(v));
  let spare = 100 - points.reduce((sum, v) => sum + v, 0);

  const byRemainder = exact
    .map((v, index) => ({ index, remainder: v - Math.floor(v) }))
    .sort((a, b) => b.remainder - a.remainder);
  for (const entry of byRemainder) {
    if (spare <= 0) break;
    points[entry.index] = (points[entry.index] ?? 0) + 1;
    spare -= 1;
  }

  components.forEach((component, index) => {
    component.weight = (points[index] ?? 0) / 100;
  });
}

function trendScore(trend: TrendState): number {
  switch (trend) {
    case "strong_bullish":
    case "strong_bearish":
      return 100;
    case "bullish":
    case "bearish":
      return 85;
    case "weak_bullish":
    case "weak_bearish":
      return 60;
    case "transition":
      return 30;
    default:
      return 35;
  }
}

function regimeFit(regime: MarketRegime, direction: "long" | "short" | "none"): number {
  if (direction === "none") return 0;
  switch (regime) {
    case "trending_up":
      return direction === "long" ? 100 : 25;
    case "trending_down":
      return direction === "short" ? 100 : 25;
    case "expansion":
      return 75;
    case "ranging":
      return 45;
    case "compression":
      return 35;
    case "high_volatility":
      return 40;
    case "low_volatility":
      return 50;
    default:
      return 50;
  }
}

export function gradeOf(score: number): SetupQuality["grade"] {
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  return "D";
}

export interface ConfidenceInput {
  dataStatus: DataStatus;
  mtf: MtfAlignment;
  pullback: PullbackReading;
  zone: SupplyDemandZone | null;
  candleCount: number;
}

/**
 * How sure the analysis layer is about its own read. Deliberately separate from
 * Setup Quality: a clean A-grade setup on demo data still gets low confidence.
 */
export function analysisConfidence(input: ConfidenceInput): number {
  let score = 80;
  const reasons: string[] = [];

  if (input.dataStatus.quality === "DEMO") {
    score -= 30;
    reasons.push("demo data");
  } else if (input.dataStatus.quality === "DELAYED") {
    score -= 10;
    reasons.push("delayed data");
  }

  if (input.candleCount < 120) score -= 20;
  else if (input.candleCount < 250) score -= 8;

  if (input.mtf.legs.length < 4) score -= 15;
  if (input.mtf.conflict) score -= 15;

  if (input.pullback.verdict === "unclear") score -= 15;
  if (!input.zone) score -= 20;

  return clamp(Math.round(score), 5, 95);
}
