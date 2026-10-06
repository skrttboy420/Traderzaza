import { NextResponse } from "next/server";
import { DEFAULT_WATCHLIST, getAsset } from "@atc/market-data";
import type { Timeframe } from "@atc/types";
import { TIMEFRAMES } from "@atc/types";

import { scanWatchlist } from "@/lib/scan";

export const dynamic = "force-dynamic";
// A watchlist scan fans out to several timeframes across several markets, and
// a free data tier is not fast. Vercel's default function timeout is short
// enough to cut that off mid-flight, so ask for the full minute.
export const maxDuration = 60;

/**
 * GET /api/scan?symbols=XAUUSD,BTCUSDT&timeframe=15m
 *
 * Multi-asset scanner (§31-32). Returns the ranked Top Opportunities plus the
 * five scanner buckets. Ordering is readiness -> Setup Quality -> R:R -> HTF
 * agreement; AI confidence never affects the order.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const timeframe = (url.searchParams.get("timeframe") ?? "15m") as Timeframe;
  const raw = url.searchParams.get("symbols");

  if (!TIMEFRAMES.includes(timeframe)) {
    return NextResponse.json({ error: `unknown timeframe: ${timeframe}` }, { status: 400 });
  }

  let symbols = DEFAULT_WATCHLIST;
  if (raw) {
    const requested = raw
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const unknown = requested.filter((s) => !getAsset(s));
    if (unknown.length > 0) {
      return NextResponse.json({ error: `unknown symbols: ${unknown.join(", ")}` }, { status: 400 });
    }
    if (requested.length > 0) symbols = requested;
  }

  try {
    const scan = await scanWatchlist(symbols, { entryTimeframe: timeframe });
    return NextResponse.json({
      scannedAt: scan.scannedAt,
      timeframe,
      opportunities: scan.opportunities,
      buckets: scan.buckets,
      scans: scan.scans,
      failed: scan.failed,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "scan failed" },
      { status: 502 },
    );
  }
}
