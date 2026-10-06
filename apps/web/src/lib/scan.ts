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

let cachedService: MarketDataService | null = null;

export function marketService(): MarketDataService {
  if (cachedService) return cachedService;
  const env = serverEnv();
  cachedService = MarketDataService.fromConfig({
    twelveDataApiKey: env.twelveDataApiKey,
    enableBinance: env.enableBinance,
    forceDemo: env.forceDemo,
  });
  return cachedService;
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
