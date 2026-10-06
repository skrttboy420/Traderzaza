import { z } from "zod";
import type { Locale, Setup } from "@atc/types";
import { renderPhrases } from "@atc/engine";

/**
 * The exact structured output the AI layer must return. Anything that does not
 * parse is rejected and the deterministic explainer is used instead, so the UI
 * can never render half-formed analysis.
 */
export const AiAnalysisSchema = z.object({
  asset: z.string().min(1),
  timeframe: z.string().min(1),
  market_regime: z.string().min(1),
  direction: z.enum(["long", "short", "none"]),
  setup_status: z.string().min(1),
  /** Setup Quality Score, 0-100. Never a win probability. */
  setup_quality: z.number().min(0).max(100),
  ai_confidence: z.number().min(0).max(100),
  entry_zone: z.object({ low: z.number(), high: z.number() }),
  confirmation_required: z.array(z.string()),
  stop_loss: z.number(),
  take_profit: z.array(z.number()),
  risk_reward: z.number(),
  why_enter: z.array(z.string()),
  why_wait: z.array(z.string()),
  invalidation: z.array(z.string()),
  facts: z.array(z.string()),
  interpretation: z.array(z.string()),
  assumptions: z.array(z.string()),
});

export type AiAnalysis = z.infer<typeof AiAnalysisSchema>;

/**
 * Language that implies certainty or guaranteed outcomes is not allowed
 * anywhere in AI output (§83).
 */
export const BANNED_PHRASES = [
  "guaranteed win",
  "guaranteed profit",
  "cannot lose",
  "can't lose",
  "risk free",
  "risk-free",
  "sure thing",
  "100% accurate",
  "95% accurate",
  "safe trade",
  "win probability",
  "winning probability",
  "financial advice",
  "การันตีกำไร",
  "ชัวร์ 100",
  "ไม่มีทางเสีย",
];

export interface GuardResult {
  ok: boolean;
  violations: string[];
}

export function guardLanguage(analysis: AiAnalysis): GuardResult {
  const haystack = [
    ...analysis.why_enter,
    ...analysis.why_wait,
    ...analysis.invalidation,
    ...analysis.facts,
    ...analysis.interpretation,
    ...analysis.assumptions,
    ...analysis.confirmation_required,
  ]
    .join(" \n ")
    .toLowerCase();

  const violations = BANNED_PHRASES.filter((p) => haystack.includes(p.toLowerCase()));
  return { ok: violations.length === 0, violations };
}

export interface ParseResult {
  analysis: AiAnalysis | null;
  error: string | null;
}

/** Tolerates models that wrap JSON in prose or fenced code blocks. */
export function parseAiAnalysis(raw: string): ParseResult {
  const json = extractJson(raw);
  if (!json) return { analysis: null, error: "no JSON object found in model output" };

  let candidate: unknown;
  try {
    candidate = JSON.parse(json);
  } catch (error) {
    return { analysis: null, error: `invalid JSON: ${error instanceof Error ? error.message : "parse failed"}` };
  }

  const parsed = AiAnalysisSchema.safeParse(candidate);
  if (!parsed.success) {
    return { analysis: null, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }

  const guard = guardLanguage(parsed.data);
  if (!guard.ok) {
    return { analysis: null, error: `banned language: ${guard.violations.join(", ")}` };
  }

  return { analysis: parsed.data, error: null };
}

function extractJson(raw: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const body = fenced?.[1] ?? raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return body.slice(start, end + 1);
}

/**
 * Numbers in AI output must match the engine. Any drift means the model
 * invented a level, and the engine values win.
 *
 * `confirmation_required` is overwritten too: it is a checklist, not prose, and
 * a model that drops an item there would show the user a setup as ready when the
 * engine still wants a trigger. The locale decides which language the engine's
 * phrases render into — the rest of the analysis is already in the user's
 * language because the prompt asked for it.
 */
export function reconcileWithEngine(analysis: AiAnalysis, setup: Setup, locale: Locale): AiAnalysis {
  const plan = setup.plans.find((p) => p.name === "Balanced") ?? setup.plans[0];
  return {
    ...analysis,
    asset: setup.symbol,
    timeframe: setup.timeframe,
    direction: setup.direction,
    setup_status: setup.status,
    setup_quality: setup.quality.score,
    ai_confidence: setup.aiConfidence,
    entry_zone: plan ? { low: plan.entryZone.low, high: plan.entryZone.high } : { low: 0, high: 0 },
    stop_loss: plan?.stopLoss ?? 0,
    take_profit: plan?.takeProfits.map((t) => t.price) ?? [],
    risk_reward: plan?.riskReward ?? 0,
    confirmation_required: renderPhrases(setup.confirmationRequired, locale),
  };
}
