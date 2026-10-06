import type { Asset, Candle, Phrase, RiskInput, RiskOutput, Trade } from "@atc/types";
import { atrAt, clamp, priceText } from "./indicators";
import { p } from "./phrases";

/**
 * Position sizing. Lots for instruments with a pip value, units for crypto.
 * Never silently rounds a stop: an invalid stop returns size 0 plus a warning.
 */
export function calculateRisk(input: RiskInput): RiskOutput {
  const warnings: Phrase[] = [];
  const { accountBalance, riskPercent, entryPrice, stopLoss, asset } = input;

  const stopDistance = Math.abs(entryPrice - stopLoss);
  const pipSize = asset.pipSize > 0 ? asset.pipSize : asset.minTick;
  const stopDistancePips = pipSize > 0 ? stopDistance / pipSize : 0;
  const riskAmount = (accountBalance * riskPercent) / 100;
  const unit: RiskOutput["unit"] = asset.pipValuePerLot === null ? "units" : "lots";

  if (accountBalance <= 0) warnings.push(p("risk.warn.balance"));
  if (riskPercent <= 0) warnings.push(p("risk.warn.riskPercentZero"));
  if (riskPercent > 2) {
    warnings.push(
      p("risk.warn.riskPercentHigh", {
        percent: riskPercent,
        total: Number((riskPercent * 4).toFixed(1)),
      }),
    );
  }
  if (stopDistance <= 0) {
    warnings.push(p("risk.warn.stopEqualsEntry"));
    return { riskAmount, stopDistance, stopDistancePips, positionSize: 0, unit, warnings };
  }

  let positionSize: number;
  if (asset.pipValuePerLot === null) {
    positionSize = riskAmount / stopDistance;
    positionSize = Number(positionSize.toFixed(6));
  } else {
    const riskPerLot = stopDistancePips * asset.pipValuePerLot;
    positionSize = riskPerLot > 0 ? riskAmount / riskPerLot : 0;
    positionSize = Number(positionSize.toFixed(2));
    if (positionSize > 0 && positionSize < 0.01) {
      warnings.push(p("risk.warn.belowMinLot"));
      positionSize = 0;
    }
  }

  if (accountBalance > 0 && accountBalance < 500) {
    warnings.push(p("risk.warn.smallAccount"));
  }

  return { riskAmount, stopDistance, stopDistancePips, positionSize, unit, warnings };
}

export interface StopSuggestion {
  price: number;
  reason: Phrase;
}

/**
 * Structure-based stop: behind the protected swing or zone edge, padded by a
 * fraction of ATR so normal noise does not take it out. Never a fixed pip value.
 *
 * `label` is a phrase, not a string, so the sentence stays translatable: the
 * caller names *which* level it is protecting and the catalogue words it.
 */
export function structuralStop(
  direction: "long" | "short",
  protectedLevel: number,
  atrValue: number,
  label: Phrase,
  /** The instrument's tick, so the level named in the sentence reads correctly. */
  minTick: number,
  padAtr = 0.3,
): StopSuggestion {
  const pad = Math.max(atrValue * padAtr, 0);
  const price = direction === "long" ? protectedLevel - pad : protectedLevel + pad;
  return {
    price,
    reason: p("risk.stop.structural", {
      pad: padAtr,
      level: label,
      price: priceText(protectedLevel, minTick),
    }),
  };
}

export interface BreakEvenDecision {
  move: boolean;
  price: number | null;
  reason: Phrase;
}

/**
 * Break-even logic driven by structure, not by an arbitrary "+N points".
 * Requirements: price has created a new protected swing in our favour AND
 * the trade is at least 1R in profit.
 */
export function breakEvenDecision(params: {
  direction: "long" | "short";
  entryPrice: number;
  stopLoss: number;
  currentPrice: number;
  /** Most recent swing that would protect the position if it holds. */
  newProtectedLevel: number | null;
  atrValue: number;
  /** The instrument's tick. Optional so existing callers keep working; without
   *  it the level in the sentence falls back to two decimals. */
  minTick?: number;
}): BreakEvenDecision {
  const { direction, entryPrice, stopLoss, currentPrice, newProtectedLevel, atrValue } = params;
  const minTick = params.minTick ?? 0.01;
  const risk = Math.abs(entryPrice - stopLoss);
  if (risk <= 0) {
    return { move: false, price: null, reason: p("risk.be.noStopDistance") };
  }

  const progress = direction === "long" ? (currentPrice - entryPrice) / risk : (entryPrice - currentPrice) / risk;
  const progressR = Number(progress.toFixed(2));

  if (progress < 1) {
    return {
      move: false,
      price: null,
      reason: p("risk.be.notEnoughProgress", { progress: progressR }),
    };
  }

  if (newProtectedLevel === null) {
    return {
      move: false,
      price: null,
      reason: p("risk.be.noNewSwing", { progress: progressR }),
    };
  }

  const beyond =
    direction === "long" ? newProtectedLevel > stopLoss : newProtectedLevel < stopLoss;
  if (!beyond) {
    return { move: false, price: null, reason: p("risk.be.swingNotBeyond") };
  }

  const pad = atrValue * 0.25;
  const price = direction === "long" ? newProtectedLevel - pad : newProtectedLevel + pad;
  return {
    move: true,
    price,
    reason: p("risk.be.move", {
      progress: progressR,
      swing: p(direction === "long" ? "label.side.higherLow" : "label.side.lowerHigh"),
      level: priceText(newProtectedLevel, minTick),
    }),
  };
}

export interface ExcursionResult {
  mfeR: number;
  maeR: number;
}

/** Max favourable / adverse excursion in R, measured over the candles after entry. */
export function excursion(
  candles: Candle[],
  trade: Pick<Trade, "direction" | "entryPrice" | "stopLoss" | "openedAt" | "closedAt">,
): ExcursionResult {
  const risk = Math.abs(trade.entryPrice - trade.stopLoss);
  if (risk <= 0) return { mfeR: 0, maeR: 0 };

  let mfe = 0;
  let mae = 0;
  for (const c of candles) {
    if (c.time < trade.openedAt) continue;
    if (trade.closedAt !== null && c.time > trade.closedAt) break;
    const favourable = trade.direction === "long" ? c.high - trade.entryPrice : trade.entryPrice - c.low;
    const adverse = trade.direction === "long" ? trade.entryPrice - c.low : c.high - trade.entryPrice;
    mfe = Math.max(mfe, favourable / risk);
    mae = Math.max(mae, adverse / risk);
  }
  return { mfeR: Number(mfe.toFixed(2)), maeR: Number(mae.toFixed(2)) };
}

export function resultR(trade: Pick<Trade, "direction" | "entryPrice" | "stopLoss" | "exitPrice">): number | null {
  if (trade.exitPrice === null) return null;
  const risk = Math.abs(trade.entryPrice - trade.stopLoss);
  if (risk <= 0) return null;
  const pnl = trade.direction === "long" ? trade.exitPrice - trade.entryPrice : trade.entryPrice - trade.exitPrice;
  return Number((pnl / risk).toFixed(2));
}

export interface PerformanceSummary {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  expectancyR: number;
  profitFactor: number;
  totalR: number;
  maxDrawdownR: number;
  averageWinR: number;
  averageLossR: number;
}

export function summarizePerformance(trades: Trade[]): PerformanceSummary {
  const closed = trades.filter((t) => t.resultR !== null);
  const rs = closed.map((t) => t.resultR ?? 0);
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r < 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const totalR = rs.reduce((a, b) => a + b, 0);

  let peak = 0;
  let equity = 0;
  let maxDd = 0;
  for (const r of rs) {
    equity += r;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }

  return {
    trades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length > 0 ? Number(((wins.length / closed.length) * 100).toFixed(1)) : 0,
    expectancyR: closed.length > 0 ? Number((totalR / closed.length).toFixed(2)) : 0,
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? Infinity : 0,
    totalR: Number(totalR.toFixed(2)),
    maxDrawdownR: Number(maxDd.toFixed(2)),
    averageWinR: wins.length > 0 ? Number((grossWin / wins.length).toFixed(2)) : 0,
    averageLossR: losses.length > 0 ? Number((grossLoss / losses.length).toFixed(2)) : 0,
  };
}

/** Risk-unit fraction suggestion for small accounts (§29). */
export function smallAccountSizeFraction(accountBalance: number, asset: Asset): number {
  if (accountBalance >= 2000) return 1;
  if (accountBalance >= 1000) return 0.75;
  if (accountBalance >= 500) return 0.5;
  return asset.pipValuePerLot === null ? 0.5 : 0.25;
}

export function atrForRisk(candles: Candle[]): number {
  return atrAt(candles, candles.length - 1);
}

export function riskPercentWarning(riskPercent: number): Phrase | null {
  const capped = clamp(riskPercent, 0, 100);
  if (capped > 5) return p("risk.warn.above5");
  if (capped > 2) return p("risk.warn.above2");
  return null;
}
