import type { Phrase, PsychologyTag, Setup, Trade, TradeClassification } from "@atc/types";
import { p } from "./phrases";

export interface ClassificationInput {
  trade: Trade;
  /** The setup the trade was taken from, when it was linked. */
  setup: Setup | null;
}

export interface ClassificationResult {
  classification: TradeClassification;
  tags: PsychologyTag[];
  reasons: Phrase[];
}

/**
 * Deterministic trade classification (§39). The point is to separate a valid
 * loss from a bad setup and from bad execution, so the review is useful.
 */
export function classifyTrade(input: ClassificationInput): ClassificationResult {
  const { trade, setup } = input;
  const tags: PsychologyTag[] = [];
  const reasons: Phrase[] = [];

  const r = trade.resultR;
  const quality = setup?.quality.score ?? null;
  const pendingAtEntry = setup?.confirmationRequired.length ?? 0;

  if (pendingAtEntry > 0) {
    tags.push("early_entry");
    reasons.push(p("psych.earlyEntry.pending", { count: pendingAtEntry }));
  }

  if (setup && setup.direction !== "none" && setup.direction !== trade.direction) {
    reasons.push(p("psych.directionMismatch"));
  }

  const plan =
    setup?.plans.find((candidate) => candidate.entryType === trade.entryType) ?? setup?.plans[0] ?? null;
  if (plan && plan.entryZone.high > 0) {
    const outside = trade.entryPrice > plan.entryZone.high || trade.entryPrice < plan.entryZone.low;
    if (outside) {
      const chased =
        trade.direction === "long"
          ? trade.entryPrice > plan.entryZone.high
          : trade.entryPrice < plan.entryZone.low;
      tags.push(chased ? "late_entry" : "early_entry");
      reasons.push(
        p("psych.outsideZone", {
          price: trade.entryPrice,
          low: plan.entryZone.low,
          high: plan.entryZone.high,
        }),
      );
    }
  }

  if (trade.maeR !== null && trade.maeR > 1.05) {
    tags.push("moved_stop");
    reasons.push(p("psych.movedStop", { mae: trade.maeR }));
  }

  if (r !== null && trade.mfeR !== null && trade.mfeR >= 1.5 && r >= -0.1 && r <= 0.1) {
    tags.push("early_breakeven");
    reasons.push(p("psych.earlyBreakeven", { mfe: trade.mfeR }));
  }

  let classification: TradeClassification;
  if (r === null) {
    classification = "missed_trade";
    reasons.push(p("psych.noResult"));
  } else if (r > 0) {
    classification =
      quality !== null && quality < 50 ? "good_setup_bad_execution" : "valid_win";
    if (quality !== null && quality < 50) {
      reasons.push(p("psych.winOnBadSetup", { score: quality }));
    }
  } else if (tags.includes("moved_stop") || tags.includes("late_entry")) {
    classification = "good_setup_bad_execution";
    reasons.push(p("psych.badExecution"));
  } else if (quality !== null && quality < 50) {
    classification = "bad_setup";
    reasons.push(p("psych.badSetup", { score: quality }));
  } else if (setup === null) {
    classification = "emotional_trade";
    reasons.push(p("psych.noSetupLinked"));
  } else {
    classification = "valid_loss";
    reasons.push(p("psych.validLoss"));
  }

  return { classification, tags: dedupe(tags), reasons };
}

export interface BehaviourWindow {
  trades: Trade[];
  /** Unix seconds. Trades outside the window are ignored. */
  from: number;
  to: number;
}

export interface BehaviourPattern {
  tag: PsychologyTag;
  occurrences: number;
  /** Evidence from the journal. Never a psychological claim without this. */
  evidence: Phrase[];
  costR: number;
}

/**
 * §42/§68: behaviour patterns are only reported when the journal contains
 * evidence. No evidence, no claim.
 */
export function detectPatterns(window: BehaviourWindow): BehaviourPattern[] {
  const trades = window.trades
    .filter((t) => t.openedAt >= window.from && t.openedAt <= window.to)
    .sort((a, b) => a.openedAt - b.openedAt);

  const map = new Map<PsychologyTag, BehaviourPattern>();
  const add = (tag: PsychologyTag, evidence: Phrase, costR: number) => {
    const existing = map.get(tag);
    if (existing) {
      existing.occurrences++;
      existing.evidence.push(evidence);
      existing.costR = Number((existing.costR + costR).toFixed(2));
      return;
    }
    map.set(tag, { tag, occurrences: 1, evidence: [evidence], costR: Number(costR.toFixed(2)) });
  };

  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    if (!t) continue;
    const r = t.resultR ?? 0;

    for (const tag of t.psychology) {
      add(tag, p("psych.evidence.tagged", { id: t.id, symbol: t.symbol, tag }), Math.min(r, 0));
    }

    const prev = trades[i - 1];
    if (prev && (prev.resultR ?? 0) < 0) {
      const gapMinutes = (t.openedAt - (prev.closedAt ?? prev.openedAt)) / 60;
      // Revenge is not symbol-specific: switching instrument after a loss is
      // the same behaviour, so the same-symbol test was an easy way to evade it.
      if (gapMinutes >= 0 && gapMinutes <= 20) {
        add(
          "revenge",
          p("psych.evidence.revenge", {
            id: t.id,
            minutes: Math.round(gapMinutes),
            previous: prev.id,
          }),
          Math.min(r, 0),
        );
      }
      if (t.size > prev.size * 1.5) {
        add(
          "oversizing",
          p("psych.evidence.oversizing", {
            id: t.id,
            size: t.size,
            previous: prev.id,
            previousSize: prev.size,
          }),
          Math.min(r, 0),
        );
      }
    }

    if (prev && (prev.resultR ?? 0) > 1 && t.size > prev.size * 1.5) {
      add(
        "overconfidence",
        p("psych.evidence.overconfidence", {
          id: t.id,
          size: t.size,
          result: prev.resultR ?? 0,
          previous: prev.id,
        }),
        Math.min(r, 0),
      );
    }
  }

  return [...map.values()].sort((a, b) => b.occurrences - a.occurrences);
}

export interface WeeklyReport {
  from: number;
  to: number;
  tradeCount: number;
  patterns: BehaviourPattern[];
  /** Facts only. Interpretation is added by the AI layer. */
  facts: Phrase[];
}

export function weeklyReport(window: BehaviourWindow): WeeklyReport {
  const trades = window.trades.filter((t) => t.openedAt >= window.from && t.openedAt <= window.to);
  const patterns = detectPatterns(window);
  const facts: Phrase[] = [p("psych.report.tradeCount", { count: trades.length })];

  const byClassification = new Map<TradeClassification, number>();
  for (const t of trades) {
    if (!t.classification) continue;
    byClassification.set(t.classification, (byClassification.get(t.classification) ?? 0) + 1);
  }
  for (const [classification, count] of byClassification) {
    facts.push(
      p("psych.report.classification", {
        count,
        classification: p(`label.classification.${classification}`),
      }),
    );
  }
  for (const pattern of patterns) {
    facts.push(
      p("psych.report.pattern", {
        tag: pattern.tag,
        count: pattern.occurrences,
        cost: pattern.costR,
      }),
    );
  }
  if (patterns.length === 0) {
    facts.push(p("psych.report.noPattern"));
  }

  return { from: window.from, to: window.to, tradeCount: trades.length, patterns, facts };
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}
