import { cookies } from "next/headers";
import { DOLLAR_BASKET, analyze, bucketByState, rankOpportunities, toScanResult } from "@atc/engine";
import type { AnalysisResult, Opportunity, ScannerBuckets } from "@atc/engine";
import { DEFAULT_WATCHLIST, MarketDataService, requireAsset } from "@atc/market-data";
import type { CandlePlanEntry } from "@atc/market-data";
import type { Candle, DataStatus, ScanResult, Timeframe } from "@atc/types";
import { MTF_CHAIN } from "@atc/types";

import { serverEnv } from "./env";
import { WATCHLIST_COOKIE, parseWatchlist } from "./watchlist";

/**
 * Server-side analysis entry point. Pages and API routes both call this, so
 * there is exactly one code path from provider -> engine and no chance of the
 * dashboard and the API disagreeing.
 */

/**
 * Held on `globalThis`, not in a module variable.
 *
 * Next.js compiles pages and route handlers into separate bundles, so a
 * module-level singleton is instantiated once per bundle rather than once per
 * process. That was measurable: with the candle cache cold, loading `/markets`
 * — which scans gold and silver — left the credit counter untouched, while a
 * single `/api/candles` call moved it. Two services, two caches, two tallies.
 *
 * Both halves of that are real costs on an 8-per-minute budget. The same gold
 * candles were fetched twice, once for the page's scan and again for the chart
 * the page embeds, and the counter shown on the settings screen only ever saw
 * the route handlers' half — so it under-reported the spend it exists to make
 * visible, which is worse than showing nothing.
 *
 * `Symbol.for` keeps it off the global namespace proper, and surviving HMR in
 * development is a side benefit: an edit no longer silently empties the cache.
 */
const SERVICE_KEY = Symbol.for("atc.marketService");

type ServiceHost = typeof globalThis & { [SERVICE_KEY]?: MarketDataService };

export function marketService(): MarketDataService {
  const host = globalThis as ServiceHost;
  const existing = host[SERVICE_KEY];
  if (existing) return existing;

  const env = serverEnv();
  const service = MarketDataService.fromConfig({
    twelveDataApiKey: env.twelveDataApiKey,
    enableBinance: env.enableBinance,
    enableYahoo: env.enableYahoo,
    forceDemo: env.forceDemo,
  });
  host[SERVICE_KEY] = service;
  return service;
}

export interface AnalyzeOptions {
  entryTimeframe?: Timeframe;
  /** Extra timeframes to load beyond the mandatory 4H/1H/15M/5M chain. */
  extraTimeframes?: Timeframe[];
  limit?: number;
  /**
   * Pre-loaded dollar-basket series. `scanWatchlist` loads them once and hands
   * the same object to every symbol, so a six-symbol scan does not ask for the
   * same three chains six times over.
   */
  peers?: Partial<Record<string, Candle[]>>;
}

/**
 * Every series one symbol's analysis loads: the mandatory chain plus whatever
 * entry timeframe the caller asked for.
 *
 * Shared by `analyzeSymbol` and the cost estimate on purpose. The estimate is
 * only worth showing if it prices the scan that actually runs, and two copies
 * of this list would drift the first time someone adds a timeframe — leaving
 * the refresh button quoting a price that is quietly too low.
 */
export function scanTimeframes(options: AnalyzeOptions = {}): Timeframe[] {
  return Array.from(
    new Set<Timeframe>([...MTF_CHAIN, options.entryTimeframe ?? "15m", ...(options.extraTimeframes ?? [])]),
  );
}

/**
 * Which symbols the server should scan for this request.
 *
 * Reads the cookie written by the settings screen and the refresh picker, so
 * the watchlist the user edits is the watchlist the server pays for. Falls
 * back to the full default when there is no cookie, which is what a first
 * visit and a crawler both get.
 */
export async function serverWatchlist(): Promise<string[]> {
  try {
    const store = await cookies();
    return parseWatchlist(store.get(WATCHLIST_COOKIE)?.value);
  } catch {
    // Called outside a request scope (a build-time render, a unit test). The
    // default is the honest answer there, not an error.
    return [...DEFAULT_WATCHLIST];
  }
}

/**
 * The 4H chains behind the dollar proxy.
 *
 * This is the one place in the app that fetches a series for a symbol other
 * than the one being analysed, so the cost deserves to be stated plainly: it
 * is zero credits. EURUSD, GBPUSD and USDJPY are all mapped to the keyless
 * Yahoo feed, which sits ahead of TwelveData in the provider chain — the
 * metered budget is never touched. They are also already in the default
 * watchlist, so on every screen that scans, these responses are cache hits
 * that the symbols' own analysis paid for anyway.
 *
 * A leg that fails is simply absent. `buildDollarContext` needs two of the
 * three and returns null below that, so a Yahoo outage degrades to "no dollar
 * component" rather than to a wrong one.
 */
export async function loadDollarPeers(
  options: AnalyzeOptions = {},
): Promise<Partial<Record<string, Candle[]>>> {
  const env = serverEnv();
  const limit = options.limit ?? env.candleLimit;
  const service = marketService();

  const settled = await Promise.allSettled(
    DOLLAR_BASKET.map(async (leg) => ({
      symbol: leg.symbol,
      // Same symbol, timeframe and limit as the pair's own 4H request, so the
      // two share a cache entry instead of each paying for their own.
      response: await service.getCandles({ symbol: leg.symbol, timeframe: "4h", limit }),
    })),
  );

  const peers: Partial<Record<string, Candle[]>> = {};
  for (const entry of settled) {
    if (entry.status !== "fulfilled") continue;
    // Demo candles are synthetic: a dollar index built from them would be a
    // confident reading of a random walk, which is worse than no reading.
    if (entry.value.response.status.quality === "DEMO") continue;
    peers[entry.value.symbol] = entry.value.response.candles;
  }
  return peers;
}

// The report's shape lives in `scan-cost.ts`, which the client half imports
// without dragging `next/headers` and the market-data service along with it.
import type { SymbolCostRow } from "./scan-cost";

export type { ScanCostReport, SymbolCostRow } from "./scan-cost";

/**
 * Price the scan before the user presses refresh.
 *
 * Per-symbol numbers are *marginal*: what including that symbol adds on top of
 * the baseline, not what it would cost alone. That is the only version that
 * answers the question being asked — "what do I save by unticking this?" — and
 * it is exact here rather than approximate, because the one place two symbols
 * could share a series is the dollar basket, and the basket is already in the
 * baseline every marginal cost is measured against.
 *
 * So the total for any selection is `baseline + sum(credits of selected)`,
 * which is what the client adds up as the user toggles rows. No round trip per
 * tick, and no chance of the sum on screen disagreeing with the server's.
 */
export function scanCost(candidates: string[] = DEFAULT_WATCHLIST, options: AnalyzeOptions = {}): {
  baseline: number;
  baselineFull: number;
  perSymbol: SymbolCostRow[];
} {
  const service = marketService();
  const limit = options.limit ?? serverEnv().candleLimit;
  const timeframes = scanTimeframes(options);

  const basketPlan: CandlePlanEntry[] = DOLLAR_BASKET.map((leg) => ({
    symbol: leg.symbol,
    timeframes: ["4h"],
  }));
  const baseline = service.estimateCost(basketPlan, limit);

  const perSymbol = candidates.map((symbol) => {
    const withSymbol = service.estimateCost([...basketPlan, { symbol, timeframes }], limit);
    const row = withSymbol.perSymbol.find((r) => r.symbol === symbol.toUpperCase());
    return {
      symbol: symbol.toUpperCase(),
      provider: row?.provider ?? "unknown",
      metered: row?.metered ?? false,
      credits: withSymbol.total - baseline.total,
      fullCredits: withSymbol.fullTotal - baseline.fullTotal,
    };
  });

  return { baseline: baseline.total, baselineFull: baseline.fullTotal, perSymbol };
}

export interface SymbolAnalysis {
  result: AnalysisResult;
  candles: Partial<Record<Timeframe, Candle[]>>;
  status: DataStatus;
}

export async function analyzeSymbol(
  symbol: string,
  options: AnalyzeOptions = {},
): Promise<SymbolAnalysis> {
  const env = serverEnv();
  const asset = requireAsset(symbol);
  const entryTimeframe = options.entryTimeframe ?? "15m";
  const timeframes = scanTimeframes(options);

  // Sequential on purpose. The legs resolve from cache in every case that
  // matters — the watchlist scan has already loaded them, and a repeat visit
  // is inside the 4H TTL — so the extra round trip is only paid on a cold
  // process, where awaiting the metered chain dominates it anyway. Racing them
  // instead would make a cold `analyzeSymbol("EURUSD")` fetch EURUSD 4H twice.
  const peers = options.peers ?? (await loadDollarPeers(options));

  const mtf = await marketService().getMtf(asset.symbol, timeframes, options.limit ?? env.candleLimit);

  const result = analyze({
    asset,
    candles: mtf.candles,
    entryTimeframe,
    dataStatus: mtf.status,
    peers,
  });

  return { result, candles: mtf.candles, status: mtf.status };
}

export interface WatchlistScan {
  results: AnalysisResult[];
  scans: ScanResult[];
  opportunities: Opportunity[];
  buckets: ScannerBuckets;
  scannedAt: number;
  /** Symbols whose analysis threw. Reported rather than silently dropped. */
  failed: { symbol: string; reason: string }[];
}

export async function scanWatchlist(
  symbols: string[] = DEFAULT_WATCHLIST,
  options: AnalyzeOptions = {},
): Promise<WatchlistScan> {
  // Two phases: load the shared dollar legs, then fan out. Letting each symbol
  // load them would have six concurrent misses race the same three cache keys
  // on a cold process, since the cache is only written once a response lands.
  const peers = options.peers ?? (await loadDollarPeers(options));
  const settled = await Promise.allSettled(symbols.map((s) => analyzeSymbol(s, { ...options, peers })));

  const results: AnalysisResult[] = [];
  const failed: { symbol: string; reason: string }[] = [];

  settled.forEach((entry, index) => {
    const symbol = symbols[index] ?? "unknown";
    if (entry.status === "fulfilled") {
      results.push(entry.value.result);
    } else {
      const reason =
        entry.reason instanceof Error ? entry.reason.message : String(entry.reason ?? "unknown error");
      failed.push({ symbol, reason });
    }
  });

  return {
    results,
    scans: results.map(toScanResult),
    opportunities: rankOpportunities(results),
    buckets: bucketByState(results),
    scannedAt: Math.floor(Date.now() / 1000),
    failed,
  };
}
