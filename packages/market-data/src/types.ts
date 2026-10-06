import type { Candle, DataQuality, DataStatus, Timeframe } from "@atc/types";

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};

export interface CandleRequest {
  symbol: string;
  timeframe: Timeframe;
  /** Number of candles requested, newest last. */
  limit: number;
  /**
   * Optional window, unix seconds. Without it a provider returns the most
   * recent `limit` candles, which is what every chart wants.
   *
   * The news reaction study needs the opposite: a handful of candles around a
   * release that happened eight months ago. Pulling 20,000 recent candles to
   * reach them would be absurd, so a provider that can serve a slice does.
   * Providers that cannot simply ignore these and the study skips what it
   * cannot measure — it never snaps a release to a nearby candle.
   */
  startTime?: number;
  endTime?: number;
}

export interface CandleResponse {
  candles: Candle[];
  status: DataStatus;
}

/**
 * Every data source implements this. The app never talks to an HTTP API
 * directly, so swapping providers is a one-line change in the resolver.
 */
export interface MarketDataProvider {
  readonly name: string;
  readonly quality: DataQuality;
  supports(symbol: string): boolean;
  fetchCandles(request: CandleRequest): Promise<CandleResponse>;
  /** Optional live stream. Providers without one return null and the UI polls. */
  subscribe?(
    request: Omit<CandleRequest, "limit">,
    onCandle: (candle: Candle) => void,
  ): (() => void) | null;
}

export function buildStatus(params: {
  quality: DataQuality;
  provider: string;
  candles: Candle[];
  note?: string;
}): DataStatus {
  const last = params.candles[params.candles.length - 1];
  const status: DataStatus = {
    quality: params.quality,
    provider: params.provider,
    lastCandleTime: last?.time ?? 0,
    candleCount: params.candles.length,
  };
  if (params.note) status.note = params.note;
  return status;
}

export class ProviderError extends Error {
  readonly provider: string;
  readonly status: number | null;

  constructor(provider: string, message: string, status: number | null = null) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
    this.provider = provider;
    this.status = status;
  }
}
