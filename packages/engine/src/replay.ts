import type { Candle, Direction, Timeframe } from "@atc/types";

export interface ReplayState {
  /** Index of the last revealed candle. */
  cursor: number;
  total: number;
  playing: boolean;
}

/**
 * §46 market replay. The deterministic engine is re-run against the revealed
 * slice only, so the replay cannot leak future candles into the analysis.
 */
export class ReplayController {
  private readonly candles: Partial<Record<Timeframe, Candle[]>>;
  private readonly driver: Timeframe;
  private state: ReplayState;

  constructor(candles: Partial<Record<Timeframe, Candle[]>>, driver: Timeframe, startIndex = 100) {
    this.candles = candles;
    this.driver = driver;
    const total = candles[driver]?.length ?? 0;
    this.state = { cursor: Math.min(Math.max(startIndex, 1), Math.max(total - 1, 1)), total, playing: false };
  }

  get current(): ReplayState {
    return { ...this.state };
  }

  get currentTime(): number {
    return this.candles[this.driver]?.[this.state.cursor]?.time ?? 0;
  }

  play(): void {
    this.state.playing = true;
  }

  pause(): void {
    this.state.playing = false;
  }

  reset(startIndex = 100): void {
    this.state.cursor = Math.min(Math.max(startIndex, 1), Math.max(this.state.total - 1, 1));
    this.state.playing = false;
  }

  /** Advance by `steps` driver candles. Returns false at the end of the data. */
  step(steps = 1): boolean {
    const next = this.state.cursor + steps;
    if (next >= this.state.total) {
      this.state.cursor = this.state.total - 1;
      this.state.playing = false;
      return false;
    }
    this.state.cursor = next;
    return true;
  }

  /**
   * The visible slice for every timeframe, truncated to the replay clock so
   * higher timeframes cannot reveal candles that have not closed yet.
   */
  visible(): Partial<Record<Timeframe, Candle[]>> {
    const clock = this.currentTime;
    const out: Partial<Record<Timeframe, Candle[]>> = {};
    for (const [tf, series] of Object.entries(this.candles) as [Timeframe, Candle[]][]) {
      if (!series) continue;
      out[tf] = tf === this.driver ? series.slice(0, this.state.cursor + 1) : series.filter((c) => c.time <= clock);
    }
    return out;
  }
}

/* -------------------------------------------------------------------------- */
/*  Practice call resolution (§47)                                            */
/* -------------------------------------------------------------------------- */

export type PracticeExitKind = "take_profit" | "stop_loss" | "window_close";

export interface PracticeCallInput {
  direction: Direction;
  entryPrice: number;
  /** Null when the call was "stay out", or when no plan supplied a stop. */
  stopLoss: number | null;
  takeProfit: number | null;
  /** Candles strictly after the entry candle, in order. */
  forward: Candle[];
}

/**
 * The full arithmetic of one practice trade. Deliberately verbose: a training
 * screen that only says "correct" teaches nothing, so every number a trader
 * would want to review afterwards is reported here.
 */
export interface PracticeResolution {
  kind: PracticeExitKind;
  /**
   * True when one candle's range contained both the stop and the target.
   * Candles carry no tick sequence, so which one was touched first is genuinely
   * unknown. We resolve to the stop — the conservative read — and flag it,
   * rather than picking the flattering outcome.
   */
  ambiguous: boolean;
  exitPrice: number;
  exitTime: number;
  barsHeld: number;
  /** Signed in the call's favour: positive means the call was going the right way. */
  movePrice: number;
  movePercent: number;
  /** Favourable move as a multiple of the risk distance. Null without a stop. */
  moveR: number | null;
  /** Best and worst excursion while the trade was open, in price. */
  mfePrice: number;
  maePrice: number;
  mfeR: number | null;
  maeR: number | null;
}

/**
 * Walk forward candle by candle and settle a practice call the way a real trade
 * settles: whichever of the stop and the target the market reached first.
 *
 * For a "none" (stay out) call the move is signed as a rise, so the caller can
 * report plainly how far price actually travelled while the trader sat out.
 */
export function resolvePracticeCall(input: PracticeCallInput): PracticeResolution | null {
  const { direction, entryPrice, stopLoss, takeProfit, forward } = input;
  const last = forward[forward.length - 1];
  if (!last || !Number.isFinite(entryPrice) || entryPrice === 0) return null;

  const long = direction !== "short";
  const risk = stopLoss === null ? null : Math.abs(entryPrice - stopLoss);
  const usableRisk = risk !== null && risk > 0 ? risk : null;
  const favour = (price: number): number => (long ? price - entryPrice : entryPrice - price);

  let mfePrice = 0;
  let maePrice = 0;
  let kind: PracticeExitKind = "window_close";
  let ambiguous = false;
  let exitPrice = last.close;
  let exitTime = last.time;
  let barsHeld = forward.length;

  for (let i = 0; i < forward.length; i += 1) {
    const bar = forward[i];
    if (!bar) continue;

    const best = favour(long ? bar.high : bar.low);
    const worst = favour(long ? bar.low : bar.high);
    if (best > mfePrice) mfePrice = best;
    if (worst < maePrice) maePrice = worst;

    const hitStop = stopLoss !== null && (long ? bar.low <= stopLoss : bar.high >= stopLoss);
    const hitTarget =
      takeProfit !== null && (long ? bar.high >= takeProfit : bar.low <= takeProfit);

    if (hitStop && hitTarget && stopLoss !== null) {
      kind = "stop_loss";
      ambiguous = true;
      exitPrice = stopLoss;
      exitTime = bar.time;
      barsHeld = i + 1;
      break;
    }
    if (hitTarget && takeProfit !== null) {
      kind = "take_profit";
      exitPrice = takeProfit;
      exitTime = bar.time;
      barsHeld = i + 1;
      break;
    }
    if (hitStop && stopLoss !== null) {
      kind = "stop_loss";
      exitPrice = stopLoss;
      exitTime = bar.time;
      barsHeld = i + 1;
      break;
    }
  }

  const movePrice = favour(exitPrice);

  return {
    kind,
    ambiguous,
    exitPrice,
    exitTime,
    barsHeld,
    movePrice,
    movePercent: (movePrice / Math.abs(entryPrice)) * 100,
    moveR: usableRisk === null ? null : movePrice / usableRisk,
    mfePrice,
    maePrice,
    mfeR: usableRisk === null ? null : mfePrice / usableRisk,
    maeR: usableRisk === null ? null : maePrice / usableRisk,
  };
}
