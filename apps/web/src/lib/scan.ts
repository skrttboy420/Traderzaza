import { analyze, bucketByState, rankOpportunities, toScanResult } from "@atc/engine";
import type { AnalysisResult, Opportunity, ScannerBuckets } from "@atc/engine";
import { DEFAULT_WATCHLIST, MarketDataService, requireAsset } from "@atc/market-data";
import type { Candle, DataStatus, ScanResult, Timeframe } from "@atc/types";
import { MTF_CHAIN } from "@atc/types";

import { serverEnv } from "./env";

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

  // Always load the mandatory chain plus the entry timeframe, de-duplicated.
  const timeframes = Array.from(
    new Set<Timeframe>([...MTF_CHAIN, entryTimeframe, ...(options.extraTimeframes ?? [])]),
  );

  const mtf = await marketService().getMtf(asset.symbol, timeframes, options.limit ?? env.candleLimit);

  const result = analyze({
    asset,
    candles: mtf.candles,
    entryTimeframe,
    dataStatus: mtf.status,
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
  const settled = await Promise.allSettled(symbols.map((s) => analyzeSymbol(s, options)));

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
