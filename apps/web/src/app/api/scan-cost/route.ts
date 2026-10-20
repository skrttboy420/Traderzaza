import { NextResponse } from "next/server";
import { DEFAULT_WATCHLIST } from "@atc/market-data";

import { marketService, scanCost, serverWatchlist } from "@/lib/scan";
import type { ScanCostReport } from "@/lib/scan";

export const dynamic = "force-dynamic";

/**
 * GET /api/scan-cost
 *
 * What the next refresh would spend, per symbol, before it is spent. The
 * refresh control polls this so the price is on screen next to the button
 * rather than discovered afterwards as a gold chart that went DEMO.
 *
 * Every tradable symbol is priced, not only the selected ones, because the
 * control lets the user tick markets on as well as off and a price that only
 * exists for the current selection cannot answer "what would adding silver
 * cost?".
 *
 * One honest limit: the numbers are this server instance's. The candle cache
 * and the credit tally both live in the process, so on a serverless host
 * another instance may hold a warmer cache or a larger spend. The estimate is
 * an upper bound on what *this* instance would charge, which is the right
 * error to make — it never promises a refresh is cheaper than it turns out to
 * be.
 */
export async function GET() {
  const { baseline, baselineFull, perSymbol } = scanCost(DEFAULT_WATCHLIST);

  const payload: ScanCostReport = {
    baseline,
    baselineFull,
    perSymbol,
    selected: await serverWatchlist(),
    quota: marketService().creditSnapshot(),
  };

  return NextResponse.json(payload);
}
