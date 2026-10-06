import type { Candle, DataStatus, Timeframe } from "@atc/types";
import { BinanceMarketDataProvider } from "./binance";
import { MockMarketDataProvider } from "./mock";
import { TwelveDataProvider } from "./twelvedata";
import type { CandleRequest, CandleResponse, MarketDataProvider } from "./types";

export interface ProviderConfig {
  twelveDataApiKey?: string | undefined;
  /** Set false to disable the keyless Binance feed (for offline development). */
  enableBinance?: boolean;
  /** Forces the demo provider for every symbol. */
  forceDemo?: boolean;
  twelveDataQuality?: "LIVE" | "DELAYED";
}

/**
 * Provider priority: real feeds first, demo last. The demo provider always
 * exists so the app never shows an empty chart, but it always reports DEMO.
 */
export function createProviders(config: ProviderConfig = {}): MarketDataProvider[] {
  if (config.forceDemo) return [new MockMarketDataProvider()];

  const providers: MarketDataProvider[] = [];
  if (config.enableBinance !== false) providers.push(new BinanceMarketDataProvider());
  if (config.twelveDataApiKey) {
    providers.push(new TwelveDataProvider(config.twelveDataApiKey, config.twelveDataQuality ?? "DELAYED"));
  }
  providers.push(new MockMarketDataProvider());
  return providers;
}

export interface MtfResponse {
  candles: Partial<Record<Timeframe, Candle[]>>;
  status: DataStatus;
}

export class MarketDataService {
  private readonly providers: MarketDataProvider[];

  constructor(providers: MarketDataProvider[]) {
    if (providers.length === 0) throw new Error("MarketDataService needs at least one provider");
    this.providers = providers;
  }

  static fromConfig(config: ProviderConfig = {}): MarketDataService {
    return new MarketDataService(createProviders(config));
  }

  providerFor(symbol: string): MarketDataProvider {
    const match = this.providers.find((p) => p.supports(symbol));
    const fallback = this.providers[this.providers.length - 1];
    if (!match && !fallback) throw new Error("no provider available");
    return match ?? (fallback as MarketDataProvider);
  }

  /** Falls back to demo data on provider failure, and says so in the status note. */
  async getCandles(request: CandleRequest): Promise<CandleResponse> {
    const provider = this.providerFor(request.symbol);
    try {
      return await provider.fetchCandles(request);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      const demo = new MockMarketDataProvider();
      const result = await demo.fetchCandles(request);
      result.status.note = `Live feed unavailable (${reason}). Showing DEMO data instead.`;
      return result;
    }
  }

  /** Loads the whole MTF chain in parallel and reports the weakest data quality. */
  async getMtf(symbol: string, timeframes: Timeframe[], limit = 400): Promise<MtfResponse> {
    const results = await Promise.all(
      timeframes.map(async (tf) => ({ tf, response: await this.getCandles({ symbol, timeframe: tf, limit }) })),
    );

    const candles: Partial<Record<Timeframe, Candle[]>> = {};
    let weakest: DataStatus | null = null;
    const rank = { LIVE: 0, DELAYED: 1, DEMO: 2 } as const;

    for (const { tf, response } of results) {
      candles[tf] = response.candles;
      if (!weakest || rank[response.status.quality] > rank[weakest.quality]) weakest = response.status;
    }

    return {
      candles,
      status:
        weakest ?? {
          quality: "DEMO",
          provider: "none",
          lastCandleTime: 0,
          candleCount: 0,
          note: "No candles loaded.",
        },
    };
  }
}
