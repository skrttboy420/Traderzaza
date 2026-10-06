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
}

const WEIGHTS = {
  zone: 0.25,
  htf: 0.2,
  mtf: 0.15,
  pullback: 0.15,
  confirmation: 0.1,
  riskReward: 0.1,
  regime: 0.05,
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

  const raw = components.reduce((sum, c) => sum + c.weight * c.score, 0);
  const score = clamp(Math.round(raw), 0, 100);
  return { score, grade: gradeOf(score), components };
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
