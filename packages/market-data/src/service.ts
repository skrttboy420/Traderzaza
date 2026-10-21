import type { Candle, DataStatus, Timeframe } from "@atc/types";
import { BinanceMarketDataProvider } from "./binance";
import { MockMarketDataProvider } from "./mock";
import { TwelveDataProvider } from "./twelvedata";
import type { CreditSnapshot } from "./twelvedata";
import { backfillCandles, type BackfillOptions, type BackfillResult } from "./history";
import type { CandleRequest, CandleResponse, MarketDataProvider } from "./types";
import { TIMEFRAME_SECONDS } from "./types";
import { YahooFinanceProvider } from "./yahoo";

export interface ProviderConfig {
  twelveDataApiKey?: string | undefined;
  /** Set false to disable the keyless Binance feed (for offline development). */
  enableBinance?: boolean;
  /**
   * Set false to disable the keyless Yahoo FX feed. Worth having as a switch
   * because there is no key to remove: if Yahoo starts refusing the host, this
   * is the only way to hand the pairs back to TwelveData.
   */
  enableYahoo?: boolean;
  /** Forces the demo provider for every symbol. */
  forceDemo?: boolean;
  twelveDataQuality?: "LIVE" | "DELAYED";
  /**
   * Divides the bar duration to get a cache lifetime. Higher means fresher
   * data and more requests; the default of 4 keeps a 5M bar under ~75s old.
   */
  freshnessDivisor?: number;
}

/**
 * How long a response for this timeframe stays fresh.
 *
 * Tied to the bar rather than fixed, because staleness only matters relative
 * to how fast the series moves: 60 seconds is most of a 5M bar's life and
 * nothing at all on a 4H. The floor stops 1M charts from fetching per render;
 * the ceiling stops a 4H bar from being trusted for half a session.
 */
export function candleTtlSeconds(timeframe: Timeframe, divisor = 4): number {
  const bar = TIMEFRAME_SECONDS[timeframe];
  return Math.min(Math.max(Math.floor(bar / Math.max(divisor, 1)), 15), 1800);
}

interface CacheEntry {
  response: CandleResponse;
  storedAt: number;
}

/** The window belongs in the key: a historical slice is a different series. */
function cacheKey(request: CandleRequest): string {
  return [
    request.symbol.toUpperCase(),
    request.timeframe,
    request.limit,
    request.startTime ?? "",
    request.endTime ?? "",
  ].join("|");
}

/**
 * Provider priority: real feeds first, demo last. The demo provider always
 * exists so the app never shows an empty chart, but it always reports DEMO.
 */
export function createProviders(config: ProviderConfig = {}): MarketDataProvider[] {
  if (config.forceDemo) return [new MockMarketDataProvider()];

  const providers: MarketDataProvider[] = [];
  if (config.enableBinance !== false) providers.push(new BinanceMarketDataProvider());
  // Ahead of TwelveData on purpose: Yahoo FX is realtime and keyless, where the
  // TwelveData free tier is delayed.
  if (config.enableYahoo !== false) providers.push(new YahooFinanceProvider());
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

/** One symbol's slice of a planned scan: which bars it would need loaded. */
export interface CandlePlanEntry {
  symbol: string;
  timeframes: Timeframe[];
}

export interface SymbolCost {
  symbol: string;
  provider: string;
  metered: boolean;
  /** Distinct series the plan needs for this symbol. */
  requests: number;
  /** Of those, how many the cache can serve without a call. */
  cached: number;
  /** Credits this symbol would spend if the scan ran now. */
  credits: number;
  /** Credits it costs with a cold cache — the price once the TTLs lapse. */
  fullCredits: number;
}

export interface ScanCost {
  total: number;
  fullTotal: number;
  perSymbol: SymbolCost[];
}

export class MarketDataService {
  private readonly providers: MarketDataProvider[];
  private readonly freshnessDivisor: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(providers: MarketDataProvider[], freshnessDivisor = 4) {
    if (providers.length === 0) throw new Error("MarketDataService needs at least one provider");
    this.providers = providers;
    this.freshnessDivisor = freshnessDivisor;
  }

  static fromConfig(config: ProviderConfig = {}): MarketDataService {
    return new MarketDataService(createProviders(config), config.freshnessDivisor ?? 4);
  }

  /** Overridable so the cache's time-dependent behaviour is testable. */
  protected now(): number {
    return Math.floor(Date.now() / 1000);
  }

  /**
   * The metered provider's allowance, or null when nothing in the chain is
   * metered. Exposed so the UI can show the budget rather than only reacting
   * to it: "gold is on DEMO" is a symptom, "7 of 8 credits spent this minute"
   * is the cause, and the trader can tell the two apart only if shown both.
   * TwelveData is the only paid-tier feed here; Binance and Yahoo are keyless.
   */
  creditSnapshot(): CreditSnapshot | null {
    const metered = this.providers.find((p): p is TwelveDataProvider => p instanceof TwelveDataProvider);
    return metered ? metered.budget.snapshot() : null;
  }

  /**
   * What a set of candle requests would cost in metered credits *right now*.
   *
   * The refresh control shows this before the press, which is the only moment
   * it is useful: once the trader has pressed, knowing the price is too late.
   *
   * Two properties make the number mean something.
   *
   * It is cache-aware, because the cache is the difference between a free
   * refresh and four credits of the eight the minute allows, and a flat
   * per-symbol price would be wrong most of the time. It is also why
   * `fullCredits` is reported alongside: immediately after a scan everything is
   * cached and every `credits` reads zero, which on its own would tell the user
   * that refreshing is permanently free.
   *
   * And it unions by symbol, so a plan that asks for gold's 4H twice is priced
   * once. The dollar basket overlaps the watchlist by three symbols; pricing
   * those legs separately would invent credits that are never spent.
   *
   * It is still an estimate. A TTL can lapse between this call and the scan,
   * and an exhausted budget turns a would-be charge into a cache read. Both
   * errors are in the safe direction — the quoted price is an upper bound.
   */
  estimateCost(plan: CandlePlanEntry[], limit: number): ScanCost {
    const now = this.now();
    const wanted = new Map<string, Set<Timeframe>>();

    for (const entry of plan) {
      const symbol = entry.symbol.toUpperCase();
      const set = wanted.get(symbol) ?? new Set<Timeframe>();
      for (const timeframe of entry.timeframes) set.add(timeframe);
      wanted.set(symbol, set);
    }

    const perSymbol: SymbolCost[] = [];
    for (const [symbol, timeframes] of wanted) {
      const provider = this.providerFor(symbol);
      let cached = 0;
      for (const timeframe of timeframes) {
        const entry = this.cache.get(cacheKey({ symbol, timeframe, limit }));
        if (!entry) continue;
        if (now - entry.storedAt < candleTtlSeconds(timeframe, this.freshnessDivisor)) cached += 1;
      }
      const requests = timeframes.size;
      perSymbol.push({
        symbol,
        provider: provider.name,
        metered: provider.metered,
        requests,
        cached,
        credits: provider.metered ? requests - cached : 0,
        fullCredits: provider.metered ? requests : 0,
      });
    }

    return {
      total: perSymbol.reduce((sum, row) => sum + row.credits, 0),
      fullTotal: perSymbol.reduce((sum, row) => sum + row.fullCredits, 0),
      perSymbol,
    };
  }

  providerFor(symbol: string): MarketDataProvider {
    const match = this.providers.find((p) => p.supports(symbol));
    const fallback = this.providers[this.providers.length - 1];
    if (!match && !fallback) throw new Error("no provider available");
    return match ?? (fallback as MarketDataProvider);
  }

  /**
   * Cached, with a three-step fallback: fresh → stale-but-real → demo.
   *
   * The cache is not an optimisation, it is what makes a metered free tier
   * usable at all. Four screens scan the watchlist and every one of them is
   * `force-dynamic`, so without this a trader clicking between Home and Setups
   * spends eight TwelveData credits out of an allowance of eight per minute.
   *
   * The ordering of the fallback is the part worth defending. When the feed
   * refuses, real candles from four minutes ago beat synthetic candles from
   * this instant: the levels on them were actually traded, which is the only
   * reason to look at a chart. Demo data is the last resort, not the first.
   * Either way the status carries the reason and the age, so the screen can
   * say which of the three it is showing.
   *
   * Only real responses are cached. Storing a demo fallback would pin
   * synthetic prices in place for the whole TTL after one failed request.
   */
  async getCandles(request: CandleRequest): Promise<CandleResponse> {
    const provider = this.providerFor(request.symbol);
    const key = cacheKey(request);
    const now = this.now();

    const cached = this.cache.get(key);
    if (cached && now - cached.storedAt < candleTtlSeconds(request.timeframe, this.freshnessDivisor)) {
      return cached.response;
    }

    try {
      const response = await provider.fetchCandles(request);
      if (response.status.quality !== "DEMO") this.cache.set(key, { response, storedAt: now });
      return response;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";

      if (cached) {
        const age = now - cached.storedAt;
        return {
          candles: cached.response.candles,
          status: {
            ...cached.response.status,
            // Real prices, but no longer current. Claiming LIVE for a series
            // that stopped updating is the lie this whole file exists to avoid.
            quality: cached.response.status.quality === "LIVE" ? "DELAYED" : cached.response.status.quality,
            note: `Live feed unavailable (${reason}). Showing the last real candles, ${age}s old.`,
          },
        };
      }

      const demo = new MockMarketDataProvider();
      const result = await demo.fetchCandles(request);
      result.status.note = `Live feed unavailable (${reason}). Showing DEMO data instead.`;
      return result;
    }
  }

  /**
   * Walks one series backwards until it has `targetBars` or the feed runs out.
   *
   * Deliberately *not* routed through `getCandles`. Two reasons, both about
   * not poisoning the thing that keeps the free tier alive. The TTL cache is
   * keyed on `{symbol, timeframe, limit, window}`, so every page of a backfill
   * is a distinct key that the live app will never ask for again — a few
   * thousand bars per entry, held for nothing. And the demo fallback is wrong
   * here: a scan that degrades to synthetic candles still draws a usable
   * chart, but synthetic candles written into a history archive become
   * permanent fake prices that later runs cannot tell from real ones. A
   * failed page ends the walk and keeps what was already real.
   *
   * The caller owns persistence. This only knows how to ask.
   */
  async backfill(params: {
    symbol: string;
    timeframe: Timeframe;
    targetBars: number;
    maxPages?: number;
    /**
     * Start the walk here instead of at the feed's newest bar. This is how a
     * stored archive is *deepened* rather than re-bought: page back from the
     * oldest bar already held.
     */
    startAt?: number;
  }): Promise<BackfillResult> {
    const provider = this.providerFor(params.symbol);
    const options: BackfillOptions = {
      timeframe: params.timeframe,
      targetBars: params.targetBars,
      pageSize: provider.maxBarsPerCall,
      fetchPage: ({ limit, endTime }) => {
        const request: CandleRequest = { symbol: params.symbol, timeframe: params.timeframe, limit };
        // Only set when we are actually windowing. An undefined endTime on the
        // first page is what asks for "the newest bars", and providers size
        // their own lookback differently for a windowed request.
        if (endTime !== undefined) request.endTime = endTime;
        return provider.fetchCandles(request);
      },
    };
    if (params.maxPages !== undefined) options.maxPages = params.maxPages;
    if (params.startAt !== undefined) options.startAt = params.startAt;
    return backfillCandles(options);
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
