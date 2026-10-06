import type { Candle, Timeframe } from "@atc/types";
import { REFERENCE_PRICES } from "./assets";
import type { CandleRequest, CandleResponse, MarketDataProvider } from "./types";
import { TIMEFRAME_SECONDS, buildStatus } from "./types";

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, fully deterministic for a given seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Mode = "impulse" | "pullback" | "range";

export interface MockOptions {
  /** Overrides the symbol-derived seed, so replay sessions can be reproduced. */
  seed?: number;
  /** Price the series ends near. Defaults to the reference price. */
  referencePrice?: number;
}

/**
 * Generates a synthetic but structurally realistic series: impulse legs,
 * corrective pullbacks and ranges, with occasional displacement candles.
 * The engine therefore finds real swings, breaks and zones instead of noise.
 *
 * This is DEMO data. It is labelled as such everywhere it is shown.
 */
export function generateCandles(request: CandleRequest, options: MockOptions = {}): Candle[] {
  const { symbol, timeframe, limit } = request;
  const step = TIMEFRAME_SECONDS[timeframe];
  const seed = options.seed ?? hashSeed(`${symbol}:${timeframe}`);
  const random = rng(seed);

  const reference = options.referencePrice ?? REFERENCE_PRICES[symbol.toUpperCase()] ?? 100;
  const scale = Math.sqrt(step / TIMEFRAME_SECONDS["15m"]);
  const sigma = reference * 0.0015 * scale;

  // Honour a slice request so demo mode exercises exactly the same code path
  // as live mode. Without this the reaction study would find no candles in
  // demo and report "no data" for a reason that is an artefact of the mock.
  const anchor = request.endTime ?? Math.floor(Date.now() / 1000);
  const endAligned = Math.floor(anchor / step) * step;
  const firstTime =
    request.startTime !== undefined
      ? Math.floor(request.startTime / step) * step
      : endAligned - (limit - 1) * step;

  const candles: Candle[] = [];
  let price = reference * (0.97 + random() * 0.06);
  let direction: 1 | -1 = random() > 0.5 ? 1 : -1;
  let mode: Mode = "impulse";
  let remaining = 10 + Math.floor(random() * 10);

  for (let i = 0; i < limit; i++) {
    if (remaining <= 0) {
      const roll = random();
      if (mode === "impulse") {
        mode = roll < 0.75 ? "pullback" : "range";
        remaining = mode === "pullback" ? 4 + Math.floor(random() * 7) : 10 + Math.floor(random() * 12);
      } else if (mode === "pullback") {
        if (roll < 0.78) {
          mode = "impulse";
          remaining = 8 + Math.floor(random() * 13);
        } else {
          direction = direction === 1 ? -1 : 1;
          mode = "impulse";
          remaining = 10 + Math.floor(random() * 14);
        }
      } else {
        mode = "impulse";
        if (roll < 0.4) direction = direction === 1 ? -1 : 1;
        remaining = 10 + Math.floor(random() * 14);
      }
    }
    remaining--;

    const gauss = (random() + random() + random() + random() - 2) / 1.2;
    let drift: number;
    let bodyScale: number;

    if (mode === "impulse") {
      const displacement = random() < 0.12;
      drift = direction * sigma * (displacement ? 2.4 : 0.55);
      bodyScale = displacement ? 2.2 : 1;
    } else if (mode === "pullback") {
      drift = -direction * sigma * 0.3;
      bodyScale = 0.55;
    } else {
      drift = 0;
      bodyScale = 0.6;
    }

    const open = price;
    const close = Math.max(open + drift + gauss * sigma * bodyScale * 0.6, reference * 0.4);
    const body = Math.abs(close - open);
    const upperWick = (0.15 + random() * 0.8) * (sigma * bodyScale * 0.7) + body * 0.1;
    const lowerWick = (0.15 + random() * 0.8) * (sigma * bodyScale * 0.7) + body * 0.1;

    const candle: Candle = {
      time: firstTime + i * step,
      open: Number(open.toFixed(6)),
      high: Number((Math.max(open, close) + upperWick).toFixed(6)),
      low: Number((Math.min(open, close) - lowerWick).toFixed(6)),
      close: Number(close.toFixed(6)),
      volume: Number(((800 + random() * 900) * (1 + body / Math.max(sigma, 1e-9))).toFixed(2)),
    };
    candles.push(candle);
    price = close;
  }

  return candles;
}

/**
 * Demo provider. Always reports quality DEMO so no screen can ever imply the
 * numbers are live.
 */
export class MockMarketDataProvider implements MarketDataProvider {
  readonly name = "mock";
  readonly quality = "DEMO" as const;
  private readonly options: MockOptions;

  constructor(options: MockOptions = {}) {
    this.options = options;
  }

  supports(): boolean {
    return true;
  }

  async fetchCandles(request: CandleRequest): Promise<CandleResponse> {
    const candles = generateCandles(request, this.options);
    return {
      candles,
      status: buildStatus({
        quality: "DEMO",
        provider: this.name,
        candles,
        note: "Generated demo data. Structure and zones are real calculations on synthetic prices — do not trade these levels.",
      }),
    };
  }
}

export function demoTimeframes(symbol: string, timeframes: Timeframe[], limit = 400): Record<string, Candle[]> {
  const out: Record<string, Candle[]> = {};
  for (const tf of timeframes) {
    out[tf] = generateCandles({ symbol, timeframe: tf, limit });
  }
  return out;
}
