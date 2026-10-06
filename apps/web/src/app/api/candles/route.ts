import { NextResponse } from "next/server";
import { TIMEFRAMES, type Timeframe } from "@atc/types";
import { getAsset } from "@atc/market-data";

import { marketService } from "@/lib/scan";
import { serverEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * GET /api/candles?symbol=XAUUSD&timeframe=15m&limit=400
 *
 * Raw OHLCV plus the data-quality status. The status is part of the payload
 * because the UI is never allowed to show candles without saying where they
 * came from (§70).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol")?.toUpperCase() ?? "";
  const timeframe = (url.searchParams.get("timeframe") ?? "15m") as Timeframe;
  const limitParam = Number(url.searchParams.get("limit"));

  if (!symbol) {
    return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  }
  if (!getAsset(symbol)) {
    return NextResponse.json({ error: `unknown symbol: ${symbol}` }, { status: 404 });
  }
  if (!TIMEFRAMES.includes(timeframe)) {
    return NextResponse.json(
      { error: `unknown timeframe: ${timeframe}`, allowed: TIMEFRAMES },
      { status: 400 },
    );
  }

  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(1000, Math.floor(limitParam))
    : serverEnv().candleLimit;

  try {
    const response = await marketService().getCandles({ symbol, timeframe, limit });
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "candle fetch failed" },
      { status: 502 },
    );
  }
}
