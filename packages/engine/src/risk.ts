import type { Asset, Candle, Phrase, RiskInput, RiskOutput, Trade } from "@atc/types";
import { atrAt, clamp, priceText } from "./indicators";
import { p } from "./phrases";

/** The smallest lot a retail broker will accept. */
const MIN_LOT = 0.01;

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
    // Compared before rounding, because rounding is what hid this. At two
    // decimals an exact 0.0076 became a tradable 0.01 — a third more risk than
    // the trader asked for, silently — and an exact 0.002 became 0.00, which
    // failed the old `> 0` guard and returned no size and no reason at all.
    // Both are the same bug and a small account meets them constantly: on a
    // $1,000 balance at 1%, a normal structural stop on gold already lands
    // here. The size is refused rather than rounded, because a stop too wide
    // for the account is a fact about the account and silently trading it at
    // the broker minimum is how a small account dies.
    const exactSize = riskPerLot > 0 ? riskAmount / riskPerLot : 0;
    if (exactSize < MIN_LOT) {
      // Naming the cost of the smallest tradable lot, and what share of this
      // balance it is, because "too wide for this account" on its own leaves
      // the trader to work out the one number that decides what to do next.
      const minLotRisk = riskPerLot * MIN_LOT;
      warnings.push(
        p("risk.warn.belowMinLot", {
          minLot: MIN_LOT,
          minLotRisk: Number(minLotRisk.toFixed(2)),
          minLotPercent:
            accountBalance > 0 ? Number(((minLotRisk / accountBalance) * 100).toFixed(2)) : 0,
          riskPercent,
        }),
      );
      positionSize = 0;
    } else {
      positionSize = Number(exactSize.toFixed(2));
    }
  }

  if (accountBalance > 0 && accountBalance < 500) {
    warnings.push(p("risk.warn.smallAccount"));
  }

  return { riskAmount, stopDistance, stopDistancePips, positionSize, unit, warnings };
}

export interface AffordableStop {
  /** Widest stop, in price, the account can size at the broker's minimum lot. */
  distance: number;
  /** The same width in the instrument's pips. */
  pips: number;
  /** The same width in minimum ticks — "points" as a retail platform shows them. */
  points: number;
  /** Money at risk at that width and the minimum lot, which is exactly 1R. */
  riskAmount: number;
}

/**
 * The widest stop this account can actually take.
 *
 * `calculateRisk` answers "can I size this particular trade" after the trade
 * exists. This answers the question that comes first and gets asked out loud:
 * *how wide a stop can I afford at all?* A trader with $300 asking for a
 * 500-point stop on gold deserves a number, not a refusal after the fact.
 *
 * Derived rather than configured. The broker's minimum lot is fixed, so a
 * balance and a risk percent already determine the answer — there is no third
 * knob, and offering one would only let the trader set a stop the account
 * cannot pay for.
 *
 * `null` where no lot minimum binds. Crypto sizes in fractional units, so any
 * stop width can be sized down to meet the risk; the constraint there is
 * exchange notional, which is a different question with a different answer.
 */
export function maxAffordableStop(
  accountBalance: number,
  riskPercent: number,
  asset: Asset,
): AffordableStop | null {
  if (asset.pipValuePerLot === null) return null;
  if (accountBalance <= 0 || riskPercent <= 0) return null;

  const pipSize = asset.pipSize > 0 ? asset.pipSize : asset.minTick;
  const riskPerPipAtMinLot = MIN_LOT * asset.pipValuePerLot;
  if (pipSize <= 0 || riskPerPipAtMinLot <= 0) return null;

  const riskAmount = (accountBalance * riskPercent) / 100;
  const pips = riskAmount / riskPerPipAtMinLot;
  const distance = pips * pipSize;

  return {
    distance,
    pips: Number(pips.toFixed(1)),
    points: asset.minTick > 0 ? Math.round(distance / asset.minTick) : 0,
    riskAmount: Number(riskAmount.toFixed(2)),
  };
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

/**
 * Closed trades below which an expectancy figure is noise wearing a decimal
 * point. Twenty is not a statistical threshold — nothing magic happens at
 * twenty — it is the point below which a single outlier still moves the
 * average far enough to flip its sign, and a number that can flip its sign is
 * not yet an answer to "does this work".
 */
export const EXPECTANCY_MIN_SAMPLE = 20;

export type SampleConfidence = "none" | "thin" | "usable";

export interface ExpectancyReading extends PerformanceSummary {
  /** Expected money per trade at the supplied 1R. */
  perTradeMoney: number;
  /** What the recorded R is worth in money at the supplied 1R. */
  totalMoney: number;
  /** Distinct calendar days on which a trade was closed. */
  tradingDays: number;
  /** Money per day actually traded — not per day on the calendar. */
  perDayMoney: number;
  confidence: SampleConfidence;
  /** Closed trades still needed before the sample means anything. */
  tradesNeeded: number;
}

/**
 * "Is this actually making money?" — in money, not in R.
 *
 * R is the right unit for risk and the wrong unit for motivation. A trader
 * working for daily expenses needs the answer in the currency they buy lunch
 * with, and the translation is one multiplication that nobody does in their
 * head at the end of a session.
 *
 * Deliberately computed against the *current* 1R rather than each trade's
 * historical risk. It answers the forward-looking question — "if I keep
 * trading this way at today's size, what does a trade earn" — which is the one
 * worth asking. It is not a P&L statement, and the gap between the two grows
 * with every change to the balance.
 *
 * `utcOffsetMinutes` is the trader's offset, so the per-day figure counts days
 * as they experienced them. An evening session that crosses UTC midnight would
 * otherwise be billed as two trading days and halve the headline.
 */
export function expectancy(
  trades: Trade[],
  riskAmount: number,
  utcOffsetMinutes = 0,
): ExpectancyReading {
  const summary = summarizePerformance(trades);

  const offsetSeconds = utcOffsetMinutes * 60;
  const days = new Set<number>();
  for (const t of trades) {
    if (t.closedAt === null || t.resultR === null) continue;
    days.add(Math.floor((t.closedAt + offsetSeconds) / 86_400));
  }
  const tradingDays = days.size;

  const money = (r: number): number => Number((r * riskAmount).toFixed(2));
  const totalMoney = money(summary.totalR);

  return {
    ...summary,
    perTradeMoney: money(summary.expectancyR),
    totalMoney,
    tradingDays,
    perDayMoney: tradingDays > 0 ? Number((totalMoney / tradingDays).toFixed(2)) : 0,
    confidence:
      summary.trades === 0 ? "none" : summary.trades < EXPECTANCY_MIN_SAMPLE ? "thin" : "usable",
    tradesNeeded: Math.max(0, EXPECTANCY_MIN_SAMPLE - summary.trades),
  };
}

export type DailyGuardState = "clear" | "caution" | "stop";

export interface DailyLimits {
  /** Net R down that ends the day. 0 disables the check. */
  maxDailyLossR: number;
  /** Trades opened since `dayStart`. 0 disables the check. */
  maxTradesPerDay: number;
  /** Positions held at the same time. 0 disables the check. */
  maxOpenPositions: number;
}

export interface DailyGuardInput {
  trades: Pick<Trade, "openedAt" | "closedAt" | "resultR">[];
  /**
   * Unix seconds for the start of the trader's day. Passed in rather than
   * derived, because "today" is a wall-clock fact about where the trader is
   * sitting and this module has no business guessing a timezone.
   */
  dayStart: number;
  limits: DailyLimits;
}

export interface DailyGuard {
  state: DailyGuardState;
  /** Sum of R across trades closed since `dayStart`. Negative is a loss. */
  netR: number;
  tradesToday: number;
  openPositions: number;
  /** Consecutive losing closes ending at the most recent one. */
  lossStreak: number;
  /** R left before the daily loss limit trips. `null` when no limit is set. */
  remainingR: number | null;
  /** Trades left today. `null` when no limit is set. */
  remainingTrades: number | null;
  reasons: Phrase[];
}

/**
 * The circuit breaker.
 *
 * A trader with an edge still loses the account on the day the edge stops being
 * the thing driving the clicks. That day is not subtle — it is three stops in a
 * row and a fourth trade taken bigger to get it back — but it is invisible from
 * inside, which is why the limit has to be set while calm and enforced while
 * not.
 *
 * Three independent brakes, because they fail in different ways: R lost catches
 * the bad day, trade count catches the overtrading that produces it, and open
 * positions catches the correlated pile-up that turns one wrong read into four
 * simultaneous stops. Any one of them tripping is a stop; they are not scored
 * against each other.
 *
 * Nothing here blocks an order — this app places none. It states the number the
 * trader already agreed to, at the moment they are least likely to recall it.
 *
 * The loss streak deliberately ignores `dayStart`. Tilt does not reset at
 * midnight; a trader who lost three in a row an hour before the date changed is
 * the same trader an hour after.
 */
export function dailyGuard(input: DailyGuardInput): DailyGuard {
  const { trades, dayStart, limits } = input;

  const closedToday = trades
    .filter((t) => t.closedAt !== null && t.closedAt >= dayStart)
    .sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));

  const netR = Number(closedToday.reduce((sum, t) => sum + (t.resultR ?? 0), 0).toFixed(2));
  const tradesToday = trades.filter((t) => t.openedAt >= dayStart).length;
  const openPositions = trades.filter((t) => t.closedAt === null).length;

  const allClosed = trades
    .filter((t) => t.closedAt !== null && t.resultR !== null)
    .sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));
  let lossStreak = 0;
  for (let i = allClosed.length - 1; i >= 0; i -= 1) {
    if ((allClosed[i]?.resultR ?? 0) >= 0) break;
    lossStreak += 1;
  }

  const lossLimit = limits.maxDailyLossR > 0 ? limits.maxDailyLossR : null;
  const tradeLimit = limits.maxTradesPerDay > 0 ? limits.maxTradesPerDay : null;
  const openLimit = limits.maxOpenPositions > 0 ? limits.maxOpenPositions : null;

  const remainingR = lossLimit === null ? null : Number(Math.max(0, lossLimit + netR).toFixed(2));
  const remainingTrades = tradeLimit === null ? null : Math.max(0, tradeLimit - tradesToday);

  const stops: Phrase[] = [];
  const cautions: Phrase[] = [];

  if (lossLimit !== null && netR <= -lossLimit) {
    stops.push(p("guard.stop.dailyLoss", { lossR: Math.abs(netR), limitR: lossLimit }));
  } else if (lossLimit !== null && netR <= -lossLimit / 2) {
    cautions.push(
      p("guard.caution.dailyLoss", {
        lossR: Math.abs(netR),
        limitR: lossLimit,
        remainingR: remainingR ?? 0,
      }),
    );
  }

  if (tradeLimit !== null && tradesToday >= tradeLimit) {
    stops.push(p("guard.stop.tradeCount", { taken: tradesToday, limit: tradeLimit }));
  } else if (tradeLimit !== null && remainingTrades === 1) {
    cautions.push(p("guard.caution.tradeCount", { taken: tradesToday, limit: tradeLimit }));
  }

  if (openLimit !== null && openPositions >= openLimit) {
    stops.push(p("guard.stop.openPositions", { open: openPositions, limit: openLimit }));
  }

  if (lossStreak >= 2) cautions.push(p("guard.caution.lossStreak", { streak: lossStreak }));

  const state: DailyGuardState =
    stops.length > 0 ? "stop" : cautions.length > 0 ? "caution" : "clear";

  const reasons = [...stops, ...cautions];

  // A day nothing has happened on has nothing to report. Saying "0 of 3 trades,
  // 0R" every morning is how a warning becomes wallpaper, and the one that
  // matters gets scrolled past with the rest.
  if (state === "clear" && (tradesToday > 0 || openPositions > 0)) {
    reasons.push(
      tradeLimit === null
        ? p("guard.clearNoCount", { taken: tradesToday, netR })
        : p("guard.clear", { taken: tradesToday, limit: tradeLimit, netR }),
    );
  }

  return {
    state,
    netR,
    tradesToday,
    openPositions,
    lossStreak,
    remainingR,
    remainingTrades,
    reasons,
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
