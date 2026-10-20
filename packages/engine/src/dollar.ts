import type { Candle, Phrase } from "@atc/types";
import { clamp } from "./indicators";
import { p } from "./phrases";

/**
 * Dollar backdrop.
 *
 * Every other module in the engine reads one symbol's own chart. This one reads
 * the thing that is on the other side of almost every instrument in the
 * watchlist: the dollar. Gold is priced in dollars, so a gold long is a dollar
 * short whether the trader thinks of it that way or not — and a gold long taken
 * into a week when EUR, GBP and JPY are all losing ground to the dollar is
 * fighting a current that no amount of 15M structure can see.
 *
 * Three constraints shaped this:
 *
 *  1. **No extra credits.** EURUSD, GBPUSD and USDJPY are already in the
 *     watchlist, and all three are served by the keyless Yahoo feed rather than
 *     the metered TwelveData one. The basket is therefore free in the only
 *     currency that is actually scarce here.
 *
 *  2. **Never grade a pair against an index it dominates.** EUR alone is 58% of
 *     the real DXY. Scoring a EURUSD setup against a proxy that EURUSD mostly
 *     *is* would dress a single pair's own move up as macro confirmation, which
 *     is worse than having no macro read at all. `buildDollarContext` takes an
 *     `exclude` and renormalises the remaining weights.
 *
 *  3. **Two legs minimum.** One pair is not an index. With EUR excluded the
 *     basket is GBP and JPY, which is thin but still two independent
 *     currencies; below that the module returns null and the component is
 *     omitted rather than guessed.
 */

/** Official DXY weights for the three legs the watchlist already carries. */
export const DOLLAR_BASKET: { symbol: string; weight: number }[] = [
  { symbol: "EURUSD", weight: 0.576 },
  { symbol: "USDJPY", weight: 0.136 },
  { symbol: "GBPUSD", weight: 0.119 },
];

/**
 * Bars of the 4H series to measure the move over. Thirty 4H bars is five
 * calendar days — long enough that a single session's noise cannot set the
 * macro read, short enough that it is still describing *this* week.
 */
export const DOLLAR_LOOKBACK = 30;

/**
 * The weighted move, in percent, that reads as a full-scale dollar week.
 *
 * DXY moving 1.5% in five days is a move everyone on a desk is talking about;
 * 0.3% is Tuesday. Percent is the right unit because the real index is itself a
 * weighted geometric mean of rates, so this is the scale traders already read
 * the dollar in, not a quantity invented here.
 */
const FULL_SCALE_PCT = 1.5;

/** Below this the move is inside the window's own noise and reads as flat. */
const FLAT_STRENGTH = 20;

/** One pair restated is not a macro reading. */
const MIN_LEGS = 2;

/**
 * Which way an instrument moves when the dollar strengthens.
 *
 * `-1` when the dollar is the quote currency (XAUUSD, EURUSD, BTCUSDT): the
 * price falls as the dollar rises. `+1` when the dollar is the base (USDJPY):
 * the price rises with it. `0` when there is no dollar leg at all.
 *
 * The same number does double duty below — it converts a pair's own percentage
 * change into the dollar's, and it says which way a trade on that pair is
 * betting the dollar goes. Those really are the same fact.
 */
export function dollarExposure(symbol: string): -1 | 0 | 1 {
  const s = symbol.toUpperCase();
  if (s.startsWith("USD")) return 1;
  if (s.endsWith("USD") || s.endsWith("USDT")) return -1;
  return 0;
}

export interface DollarLeg {
  symbol: string;
  /** Share of the basket after renormalising over the legs that were usable. */
  weight: number;
  /** The pair's own percentage change over the window. */
  changePct: number;
  /** The same move read as the dollar's: `dollarExposure * changePct`. */
  dollarPct: number;
}

export type DollarMove = "strengthening" | "weakening" | "flat";

export const dollarMovePhrase = (move: DollarMove): Phrase => ({ key: `label.move.${move}` });

export interface DollarContext {
  /** -100..100. Positive means the dollar gained over the window. */
  strength: number;
  move: DollarMove;
  /** 0-100. Share of basket weight pointing the same way as the net move. */
  agreement: number;
  /** Legs that were usable, biggest contributor first. */
  legs: DollarLeg[];
  facts: Phrase[];
}

export interface DollarContextOptions {
  /** Symbol whose own leg must not be counted. Case-insensitive. */
  exclude?: string;
  /** Bars to look back. Defaults to {@link DOLLAR_LOOKBACK}. */
  lookback?: number;
}

/**
 * Build the dollar reading from whichever basket legs were loaded.
 *
 * `series` is expected to hold 4H candles — the same chains the scanner fetches
 * for those pairs' own analysis. A leg with fewer than `lookback + 1` bars is
 * dropped rather than measured over a shorter window: a three-day EUR move and
 * a five-day JPY move do not belong in the same weighted average.
 */
export function buildDollarContext(
  series: Partial<Record<string, Candle[]>>,
  options: DollarContextOptions = {},
): DollarContext | null {
  const lookback = options.lookback ?? DOLLAR_LOOKBACK;
  const exclude = options.exclude?.toUpperCase();

  const raw: { symbol: string; weight: number; changePct: number; dollarPct: number }[] = [];
  for (const spec of DOLLAR_BASKET) {
    if (spec.symbol === exclude) continue;
    const candles = series[spec.symbol];
    if (!candles || candles.length < lookback + 1) continue;
    const last = candles[candles.length - 1];
    const first = candles[candles.length - 1 - lookback];
    if (!last || !first || !(first.close > 0)) continue;
    const changePct = ((last.close - first.close) / first.close) * 100;
    raw.push({
      symbol: spec.symbol,
      weight: spec.weight,
      changePct,
      dollarPct: dollarExposure(spec.symbol) * changePct,
    });
  }

  if (raw.length < MIN_LEGS) return null;

  const total = raw.reduce((sum, leg) => sum + leg.weight, 0);
  if (!(total > 0)) return null;

  const weightedPct = raw.reduce((sum, leg) => sum + (leg.weight / total) * leg.dollarPct, 0);
  const strength = clamp(Math.round((weightedPct / FULL_SCALE_PCT) * 100), -100, 100);

  // A leg sitting exactly flat is counted as neither agreeing nor disagreeing,
  // which lowers agreement. That is the honest reading: a pair that did not
  // move is not confirmation of a dollar move, it is the absence of one.
  const netSign = Math.sign(weightedPct);
  const aligned =
    netSign === 0
      ? 0
      : raw.filter((leg) => Math.sign(leg.dollarPct) === netSign).reduce((sum, leg) => sum + leg.weight, 0);
  const agreement = clamp(Math.round((aligned / total) * 100), 0, 100);

  const move: DollarMove =
    Math.abs(strength) < FLAT_STRENGTH ? "flat" : strength > 0 ? "strengthening" : "weakening";

  const legs: DollarLeg[] = raw
    .map((leg) => ({
      symbol: leg.symbol,
      weight: Number((leg.weight / total).toFixed(4)),
      changePct: Number(leg.changePct.toFixed(3)),
      dollarPct: Number(leg.dollarPct.toFixed(3)),
    }))
    .sort((a, b) => Math.abs(b.dollarPct * b.weight) - Math.abs(a.dollarPct * a.weight));

  const leader = legs[0];
  const facts: Phrase[] =
    move === "flat"
      ? [p("dollar.fact.flat", { count: legs.length })]
      : [
          p("dollar.fact.move", {
            move: dollarMovePhrase(move),
            strength: Math.abs(strength),
            agreement,
            count: legs.length,
          }),
          ...(leader ? [p("dollar.fact.leader", { symbol: leader.symbol, changePct: leader.changePct })] : []),
        ];

  return { strength, move, agreement, legs, facts };
}

export type DollarStance = "tailwind" | "headwind" | "neutral";

export const dollarStancePhrase = (stance: DollarStance): Phrase => ({ key: `label.stance.${stance}` });

export interface DollarAlignment {
  stance: DollarStance;
  /** 0-100 for the score breakdown. 50 is "the dollar says nothing". */
  score: number;
  /** 0-100. Size of the move times how unanimous it is. */
  conviction: number;
}

/**
 * Read the backdrop against one trade.
 *
 * Returns null — rather than a neutral 50 — for an instrument with no dollar
 * leg, so the score breakdown omits the component instead of diluting the rest
 * with a number that was never measured. A *flat* dollar does score 50: that is
 * a reading, and "no macro wind either way" is worth saying.
 *
 * The score moves off 50 by half the conviction, so the component can only
 * reach 0 or 100 on a full-scale move every leg agrees with. A 0.4% drift that
 * two legs out of three disagree about lands around 45 — a nudge, which is all
 * a macro backdrop should ever be against a 15M structure read.
 */
export function dollarAlignment(
  symbol: string,
  direction: "long" | "short" | "none",
  context: DollarContext | null,
): DollarAlignment | null {
  if (!context || direction === "none") return null;
  const exposure = dollarExposure(symbol);
  if (exposure === 0) return null;

  // What this trade needs the dollar to do. Long gold (exposure -1) needs it
  // to fall; long USDJPY (exposure +1) needs it to rise.
  const bet = (direction === "long" ? 1 : -1) * exposure;
  const conviction = clamp(Math.round((Math.abs(context.strength) * context.agreement) / 100), 0, 100);

  if (context.move === "flat") return { stance: "neutral", score: 50, conviction };

  const dollarSign = context.move === "strengthening" ? 1 : -1;
  const stance: DollarStance = bet === dollarSign ? "tailwind" : "headwind";
  const score = clamp(Math.round(50 + (stance === "tailwind" ? 1 : -1) * (conviction / 2)), 0, 100);
  return { stance, score, conviction };
}
