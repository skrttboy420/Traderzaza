import type { Candle, DataQuality, DataStatus, Timeframe } from "@atc/types";

/**
 * Re-exported from `@atc/types`, where it moved so the engine can use it too.
 * Kept here because every provider in this package already imports it from
 * `./types`, and a re-export is cheaper than touching all of them.
 */
export { TIMEFRAME_SECONDS } from "@atc/types";

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
  /**
   * Whether a call to this provider spends a metered allowance.
   *
   * Required rather than optional on purpose. The refresh control prices a scan
   * before the user presses it, and a provider that quietly costs money while
   * reporting nothing would turn that number into a lie — the one failure mode
   * the whole feature exists to prevent. Making it mandatory means a new
   * provider cannot be added without someone answering the question.
   */
  readonly metered: boolean;
  /**
   * Most candles one call can return. Required for the same reason `metered`
   * is: the history backfill pages backwards until the feed stops yielding
   * older bars, and asking for more than this per page does not fail — the
   * surplus is silently dropped while the call costs exactly the same. On the
   * metered feed that is a credit bought and thrown away, repeatedly. Making
   * it mandatory means the number is measured against each API rather than
   * guessed once and inherited by every provider added afterwards.
   */
  readonly maxBarsPerCall: number;
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
