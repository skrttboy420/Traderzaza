import { DEFAULT_WATCHLIST, requireAsset } from "@atc/market-data";
import type { TrendState } from "@atc/types";

import { scanWatchlist } from "@/lib/scan";
import { MarketsView, type MarketRow } from "./MarketsView";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// A watchlist scan fans out to several timeframes across several markets, and
// a free data tier is not fast. Vercel's default function timeout is short
// enough to cut that off mid-flight, so ask for the full minute.
export const maxDuration = 60;

export default async function MarketsPage() {
  const scan = await scanWatchlist(DEFAULT_WATCHLIST);

  const rows: MarketRow[] = scan.results.map((result) => {
    // HTF bias comes from the top of the mandatory chain, falling back down it
    // if a higher timeframe had too little history to read.
    const htfTrend: TrendState =
      result.structures.find((s) => s.timeframe === "4h")?.trend ??
      result.structures.find((s) => s.timeframe === "1h")?.trend ??
      result.structures[0]?.trend ??
      "ranging";

    return {
      symbol: result.symbol,
      asset: requireAsset(result.symbol),
      price: result.price,
      htfTrend,
      best: result.best,
      dataStatus: result.dataStatus,
      setupCount: result.setups.filter((s) => s.scannerState !== "NO_TRADE").length,
    };
  });

  return <MarketsView data={{ rows, failed: scan.failed }} />;
}
