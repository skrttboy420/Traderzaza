import type { Candle } from "@atc/types";

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i] ?? 0;
    if (i >= period) sum -= values[i - period] ?? 0;
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  let seed = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? 0;
    if (i < period - 1) {
      seed += v;
      out.push(null);
      continue;
    }
    if (prev === null) {
      seed += v;
      prev = seed / period;
    } else {
      prev = v * k + prev * (1 - k);
    }
    out.push(prev);
  }
  return out;
}

export function trueRange(candles: Candle[], i: number): number {
  const c = candles[i];
  if (!c) return 0;
  const prev = candles[i - 1];
  if (!prev) return c.high - c.low;
  return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
}

/** Wilder ATR. Values before `period` are null. */
export function atr(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = [];
  let prev: number | null = null;
  let seed = 0;
  for (let i = 0; i < candles.length; i++) {
    const tr = trueRange(candles, i);
    if (i < period) {
      seed += tr;
      out.push(i === period - 1 ? seed / period : null);
      if (i === period - 1) prev = seed / period;
      continue;
    }
    prev = ((prev ?? tr) * (period - 1) + tr) / period;
    out.push(prev);
  }
  return out;
}

/** Last non-null ATR, falling back to a range average so the engine never divides by zero. */
export function atrAt(candles: Candle[], index: number, period = 14): number {
  const series = atr(candles, period);
  for (let i = Math.min(index, series.length - 1); i >= 0; i--) {
    const v = series[i];
    if (v !== null && v !== undefined && v > 0) return v;
  }
  let sum = 0;
  let n = 0;
  for (let i = 0; i <= Math.min(index, candles.length - 1); i++) {
    const c = candles[i];
    if (!c) continue;
    sum += c.high - c.low;
    n++;
  }
  return n > 0 && sum > 0 ? sum / n : 1;
}

export function rsi(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = [];
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    if (!c || !prev) {
      out.push(null);
      continue;
    }
    const diff = c.close - prev.close;
    const gain = Math.max(diff, 0);
    const loss = Math.max(-diff, 0);
    if (i <= period) {
      avgGain += gain;
      avgLoss += loss;
      if (i === period) {
        avgGain /= period;
        avgLoss /= period;
        out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
      } else {
        out.push(null);
      }
      continue;
    }
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return out;
}

export interface CandleMetrics {
  range: number;
  body: number;
  /** 0-1 share of the range taken by the body. */
  bodyRatio: number;
  upperWick: number;
  lowerWick: number;
  bullish: boolean;
  /** Range in ATR multiples. */
  rangeAtr: number;
  /** Body in ATR multiples. */
  bodyAtr: number;
}

export function candleMetrics(candles: Candle[], index: number, atrValue: number): CandleMetrics {
  const c = candles[index];
  if (!c) {
    return {
      range: 0,
      body: 0,
      bodyRatio: 0,
      upperWick: 0,
      lowerWick: 0,
      bullish: false,
      rangeAtr: 0,
      bodyAtr: 0,
    };
  }
  const range = Math.max(c.high - c.low, 0);
  const body = Math.abs(c.close - c.open);
  const safeAtr = atrValue > 0 ? atrValue : 1;
  return {
    range,
    body,
    bodyRatio: range > 0 ? body / range : 0,
    upperWick: c.high - Math.max(c.open, c.close),
    lowerWick: Math.min(c.open, c.close) - c.low,
    bullish: c.close >= c.open,
    rangeAtr: range / safeAtr,
    bodyAtr: body / safeAtr,
  };
}

/** Average volume over the `period` candles ending at `index`. Returns 0 when volume is absent. */
export function volumeAverage(candles: Candle[], index: number, period = 20): number {
  let sum = 0;
  let n = 0;
  for (let i = Math.max(0, index - period + 1); i <= index; i++) {
    const c = candles[i];
    if (!c) continue;
    sum += c.volume;
    n++;
  }
  return n > 0 ? sum / n : 0;
}

export function highestHigh(candles: Candle[], from: number, to: number): number {
  let out = -Infinity;
  for (let i = Math.max(0, from); i <= Math.min(to, candles.length - 1); i++) {
    const c = candles[i];
    if (c && c.high > out) out = c.high;
  }
  return out === -Infinity ? 0 : out;
}

export function lowestLow(candles: Candle[], from: number, to: number): number {
  let out = Infinity;
  for (let i = Math.max(0, from); i <= Math.min(to, candles.length - 1); i++) {
    const c = candles[i];
    if (c && c.low < out) out = c.low;
  }
  return out === Infinity ? 0 : out;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, minTick: number): number {
  if (minTick <= 0) return value;
  const decimals = Math.max(0, Math.ceil(-Math.log10(minTick)));
  return Number((Math.round(value / minTick) * minTick).toFixed(decimals));
}
