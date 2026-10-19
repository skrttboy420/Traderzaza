import { NextResponse } from "next/server";
import { getAsset } from "@atc/market-data";
import type { NewsImpact } from "@atc/news";

import { symbolNews } from "@/lib/news";

export const dynamic = "force-dynamic";

/**
 * GET /api/news?symbol=XAUUSD[&minImpact=2][&ahead=120][&past=12][&limit=40]
 *
 * The economic calendar, filtered to the currencies that actually move this
 * market, plus a blackout verdict. The impact rating is the source's own, not
 * ours — this endpoint never scores or predicts a release.
 *
 * `provider` and `demo` are always returned so the screen can label the data.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol")?.toUpperCase() ?? "";
  if (!symbol) return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  if (!getAsset(symbol)) {
    return NextResponse.json({ error: `unknown symbol: ${symbol}` }, { status: 404 });
  }

  const impactParam = Number(url.searchParams.get("minImpact"));
  const minImpact: NewsImpact = impactParam === 1 || impactParam === 3 ? impactParam : 2;
  const ahead = Number(url.searchParams.get("ahead"));
  const past = Number(url.searchParams.get("past"));
  // The cap bounds the payload, nothing more. A caller that widens its window
  // has to be able to widen this with it: rows are returned oldest first, so a
  // cap that bites silently removes the far end of the window rather than
  // reporting that it did — which would read as "nothing is scheduled".
  const limit = Number(url.searchParams.get("limit"));

  try {
    const news = await symbolNews(symbol, {
      minImpact,
      ...(Number.isFinite(ahead) && ahead > 0 ? { aheadHours: Math.min(ahead, 336) } : {}),
      ...(Number.isFinite(past) && past > 0 ? { pastHours: Math.min(past, 168) } : {}),
      ...(Number.isFinite(limit) && limit > 0 ? { limit: Math.min(limit, 200) } : {}),
    });
    return NextResponse.json(news);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "calendar failed" },
      { status: 502 },
    );
  }
}
