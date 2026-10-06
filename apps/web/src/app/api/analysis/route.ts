import { NextResponse } from "next/server";
import { getAsset } from "@atc/market-data";
import { TIMEFRAMES, type Timeframe } from "@atc/types";

import { analyzeSymbol } from "@/lib/scan";

export const dynamic = "force-dynamic";
// A watchlist scan fans out to several timeframes across several markets, and
// a free data tier is not fast. Vercel's default function timeout is short
// enough to cut that off mid-flight, so ask for the full minute.
export const maxDuration = 60;

/**
 * GET /api/analysis?symbol=XAUUSD&timeframe=15m[&candles=1]
 *
 * The full deterministic read for one market: structure per timeframe, zones,
 * regime, pullback verdict, MTF alignment and the ranked setups. Every number
 * here was computed in code — no language model is involved in this endpoint.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol")?.toUpperCase() ?? "";
  const timeframe = (url.searchParams.get("timeframe") ?? "15m") as Timeframe;
  const includeCandles = url.searchParams.get("candles") === "1";

  if (!symbol) return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  if (!getAsset(symbol)) {
    return NextResponse.json({ error: `unknown symbol: ${symbol}` }, { status: 404 });
  }
  if (!TIMEFRAMES.includes(timeframe)) {
    return NextResponse.json({ error: `unknown timeframe: ${timeframe}` }, { status: 400 });
  }

  try {
    const { result, candles } = await analyzeSymbol(symbol, { entryTimeframe: timeframe });
    return NextResponse.json(includeCandles ? { ...result, candles } : result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "analysis failed" },
      { status: 502 },
    );
  }
}
