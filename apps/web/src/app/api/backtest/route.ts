import { NextResponse } from "next/server";
import { backtest } from "@atc/engine";
import { requireAsset } from "@atc/market-data";
import type { Candle, Timeframe } from "@atc/types";

import { serverEnv } from "@/lib/env";
import { marketService, scanTimeframes } from "@/lib/scan";
import { modeStates, parseBacktestRequest, type BacktestResponse } from "@/lib/backtest";

export const dynamic = "force-dynamic";

/**
 * The run is CPU-bound and takes seconds, not milliseconds. The platform
 * default of 10s is close enough to the measured time that a slower cold
 * instance would be cut off mid-run and reported as a network error.
 */
export const maxDuration = 60;

/**
 * Bars between analyses.
 *
 * Measured rather than guessed, and the measurement is the justification: on
 * four days of gold, stride 1 settles 17 trades in 7.5s and stride 2 settles
 * 15 in 3.5s. Halving the work costs two trades because the sample is not
 * bounded by how often the engine speaks — it speaks on 213 of 279 bars — but
 * by the one-position-at-a-time rule and the once-per-zone rule, which
 * collapse long runs of adjacent signals into a single trade regardless. A
 * stride of 1 mostly buys duplicate readings of zones already being traded.
 */
const STRIDE = 2;

/**
 * GET /api/backtest?symbol=XAUUSD&timeframe=15m
 *
 * Replays the engine bar by bar over the history already in memory and reports
 * what its own signals would have settled at. This is the only endpoint that
 * grades the grader: everywhere else the app presents a setup's letter as
 * meaningful, and until this ran, nothing had checked that an A earns more
 * than a C.
 *
 * Two design choices are worth stating because both are easy to reverse by
 * accident.
 *
 * It runs on the server, not the browser. `analyze` is re-run once per bar —
 * a few hundred times — over four timeframes of indicators. In a tab that is
 * a frozen UI on a phone; here it is one request that resolves in a couple of
 * seconds and can be cancelled by navigating away.
 *
 * It asks for exactly the series the scan asks for: the same symbol, the same
 * chain, and `candleLimit` rather than a limit of its own. The cache keys on
 * `{symbol, timeframe, limit}`, so requesting more history would miss on every
 * key and refetch gold's four bars at full price on every press — and worse,
 * would keep a second set of entries warm alongside the scan's, doubling the
 * standing cost of the market. Pinning the limit means a backtest is free
 * while the page's own candles are warm and never dearer than one refresh of
 * the same market when they are not. `credits` below reports which of those
 * two actually happened rather than asserting the cheerful one.
 *
 * The price of that choice is paid in history: roughly four days of 15-minute
 * bars, which is usually too thin for a per-grade verdict. The report says so
 * rather than inventing one.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = parseBacktestRequest({
    symbol: url.searchParams.get("symbol"),
    timeframe: url.searchParams.get("timeframe"),
    mode: url.searchParams.get("mode"),
  });

  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { symbol, timeframe, mode } = parsed.request;
  const asset = requireAsset(symbol);
  const limit = serverEnv().candleLimit;
  const service = marketService();

  // Measured, not estimated. `scanCost` answers "what would this cost"; here
  // the run has already happened and the honest number is the difference the
  // tally actually moved. Clamped at zero because the day counter resets, and
  // a negative spend on screen would be worse than a cautious one.
  const before = service.creditSnapshot();

  try {
    const started = Date.now();
    const mtf = await service.getMtf(asset.symbol, scanTimeframes({ entryTimeframe: timeframe }), limit);

    const report = backtest({
      asset,
      candles: mtf.candles,
      entryTimeframe: timeframe,
      dataStatus: mtf.status,
      options: { states: modeStates(mode), stride: STRIDE },
    });

    const ranMs = Date.now() - started;
    const after = service.creditSnapshot();

    const bars: Partial<Record<Timeframe, number>> = {};
    for (const [tf, series] of Object.entries(mtf.candles) as [Timeframe, Candle[] | undefined][]) {
      if (series) bars[tf] = series.length;
    }

    const payload: BacktestResponse = {
      request: parsed.request,
      report,
      stride: STRIDE,
      bars,
      status: mtf.status,
      credits: before && after ? Math.max(0, after.dayUsed - before.dayUsed) : null,
      ranMs,
    };

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "backtest failed" },
      { status: 502 },
    );
  }
}
