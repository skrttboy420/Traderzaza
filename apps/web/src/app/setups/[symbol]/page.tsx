import { notFound } from "next/navigation";
import { getAsset } from "@atc/market-data";
import { TIMEFRAMES, type Candle, type Timeframe } from "@atc/types";

import { analyzeSymbol } from "@/lib/scan";
import { SetupDetailView, type SetupDetailData } from "./SetupDetailView";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// A watchlist scan fans out to several timeframes across several markets, and
// a free data tier is not fast. Vercel's default function timeout is short
// enough to cut that off mid-flight, so ask for the full minute.
export const maxDuration = 60;

/** Candles kept per timeframe for the chart payload. The engine already read the
 *  full history server-side; the browser only needs enough to draw. */
const CHART_CANDLES = 220;

export default async function SetupDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<{ setup?: string; tf?: string }>;
}) {
  const { symbol: rawSymbol } = await params;
  const query = await searchParams;

  const symbol = decodeURIComponent(rawSymbol).toUpperCase();
  const asset = getAsset(symbol);
  if (!asset) notFound();

  const requestedTf = query.tf as Timeframe | undefined;
  const entryTimeframe: Timeframe =
    requestedTf && TIMEFRAMES.includes(requestedTf) ? requestedTf : "15m";

  // 1D is loaded for the chart only. It is deliberately not in MTF_CHAIN: the
  // mandatory 4H->1H->15M->5M chain is what the entry decision is allowed to
  // use, and quietly adding a daily leg would change every score on the page.
  // This just gives the trader the higher-timeframe picture to look at.
  const { result, candles, status } = await analyzeSymbol(symbol, {
    entryTimeframe,
    extraTimeframes: ["1d"],
  });

  const trimmed: Partial<Record<Timeframe, Candle[]>> = {};
  for (const [tf, series] of Object.entries(candles) as [Timeframe, Candle[] | undefined][]) {
    if (series && series.length > 0) trimmed[tf] = series.slice(-CHART_CANDLES);
  }

  const data: SetupDetailData = {
    symbol,
    asset,
    entryTimeframe: result.entryTimeframe,
    price: result.price,
    regime: result.regime,
    pullback: result.pullback,
    mtf: result.mtf,
    setups: result.setups,
    zones: result.zones,
    structures: result.structures,
    candles: trimmed,
    dataStatus: status,
    noTradeReasons: result.noTradeReasons,
    initialSetupId: query.setup ?? null,
  };

  return <SetupDetailView data={data} />;
}
