import { NextResponse } from "next/server";
import { getAsset } from "@atc/market-data";

import { eventReaction } from "@/lib/news";

export const dynamic = "force-dynamic";
// Up to ten past releases, each priced from its own small candle slice. Cached
// for hours afterwards, but the first caller pays for all of it.
export const maxDuration = 60;

/**
 * GET /api/news/reaction?symbol=XAUUSD&eventId=894953698[&path=US|ISM Services PMI]
 *
 * "Last time this printed hot, what did gold do?" — answered by measuring the
 * 30 minutes after every past release we can price, grouped by whether the
 * number beat or missed its forecast.
 *
 * It is a measurement of the past, not a forecast, and the response carries
 * everything the UI needs to say so: the sample count per group, how many
 * releases could not be priced, and the quality of the price data used.
 * `study.usable === false` means the UI must show "not enough history" instead
 * of a number.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol")?.toUpperCase() ?? "";
  const eventId = Number(url.searchParams.get("eventId"));
  const path = url.searchParams.get("path") ?? undefined;

  if (!symbol) return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  if (!getAsset(symbol)) {
    return NextResponse.json({ error: `unknown symbol: ${symbol}` }, { status: 404 });
  }
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return NextResponse.json({ error: "eventId is required" }, { status: 400 });
  }

  try {
    const reaction = await eventReaction(symbol, eventId, path);
    if (!reaction) {
      // No history at all is a real answer, and a different one from "the
      // history exists but is too thin to generalise from".
      return NextResponse.json({ available: false, reason: "noHistory" });
    }
    return NextResponse.json({ available: true, ...reaction });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "reaction study failed" },
      { status: 502 },
    );
  }
}
