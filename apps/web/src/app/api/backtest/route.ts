import { NextResponse } from "next/server";
import { backtest } from "@atc/engine";
import { barsForDays, requireAsset } from "@atc/market-data";
import type { Candle, Timeframe } from "@atc/types";

import { archiveConfigured, archiveCoverage, readCandles } from "@/lib/candle-archive";
import { serverEnv } from "@/lib/env";
import { marketService, scanTimeframes } from "@/lib/scan";
import {
  BACKTEST_DEPTH_DAYS,
  backtestStride,
  modeStates,
  parseBacktestRequest,
  type BacktestCoverage,
  type BacktestResponse,
  type BacktestSource,
} from "@/lib/backtest";

export const dynamic = "force-dynamic";

/**
 * The run is CPU-bound and takes seconds, not milliseconds. The platform
 * default of 10s is close enough to the measured time that a slower cold
 * instance would be cut off mid-run and reported as a network error.
 */
export const maxDuration = 60;

/**
 * Read one timeframe's deep history, or report that there is none.
 *
 * Returns null rather than an empty array so the caller can tell "the archive
 * has nothing for this series" from "the archive has this series and it is
 * empty" — the first falls back to the live window, the second would silently
 * backtest on no bars and report a quiet market.
 */
async function archiveSeries(
  symbol: string,
  timeframe: Timeframe,
  limit: number,
): Promise<Candle[] | null> {
  const stored = await readCandles({ symbol, timeframe, limit });
  return stored.length > 0 ? stored : null;
}

/** What is stored for the entry series, in the shape the panel renders. */
async function coverageFor(symbol: string, timeframe: Timeframe): Promise<BacktestCoverage> {
  const configured = archiveConfigured();
  if (!configured) return { bars: 0, days: 0, configured: false };

  const stored = await archiveCoverage({ symbol, timeframe });
  const days =
    stored.newest !== null && stored.oldest !== null
      ? Math.round((stored.newest - stored.oldest) / 86400)
      : 0;
  return { bars: stored.bars, days, configured: true };
}

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
 * It prefers stored history and falls back to the live window. The archive is
 * read for free and is as deep as the last backfill made it; the live path
 * asks the scan's own `{symbol, timeframe, candleLimit}` cache keys, so it is
 * free while the page's candles are warm and never dearer than one refresh of
 * the same market when they are not. Requesting a *different* limit from the
 * live feed would miss on every key and keep a second set of entries warm
 * alongside the scan's, doubling the standing cost of the market — which is
 * why deep history lives in the database rather than in a bigger fetch.
 *
 * The fallback is reported, never inferred. Four days of bars almost always
 * settles too few trades for a per-grade verdict, and `thin` from a shallow
 * run means "ask again when there is more history", while `thin` from a
 * four-month run means something much worse about the strategy. `source` is
 * what lets the panel tell those apart.
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
    const chain = scanTimeframes({ entryTimeframe: timeframe });

    // The live call happens either way: it is what reports data quality and
    // provider for the series head, and on a warm cache it is free. The
    // archive only replaces the *bars*.
    const mtf = await service.getMtf(asset.symbol, chain, limit);

    const stored = await Promise.all(
      chain.map(async (tf) => ({
        tf,
        series: await archiveSeries(
          asset.symbol,
          tf,
          barsForDays(tf, BACKTEST_DEPTH_DAYS),
        ),
      })),
    );

    // All or nothing per run, not per timeframe. A deep entry series mixed
    // with a 400-bar 4H series is the worst of both: the walk starts months
    // back, but every step before the 4H window opens analyses a chart with
    // no higher-timeframe context at all, and silently grades a different
    // engine from the one on screen.
    const complete = stored.every((entry) => entry.series !== null);
    const source: BacktestSource = complete ? "archive" : "live";

    const candles: Partial<Record<Timeframe, Candle[]>> = { ...mtf.candles };
    if (complete) {
      for (const { tf, series } of stored) if (series) candles[tf] = series;
    }

    const entryBars = candles[timeframe]?.length ?? 0;
    const stride = backtestStride(entryBars);

    const report = backtest({
      asset,
      candles,
      entryTimeframe: timeframe,
      dataStatus: mtf.status,
      options: { states: modeStates(mode), stride },
    });

    const ranMs = Date.now() - started;
    const after = service.creditSnapshot();

    const bars: Partial<Record<Timeframe, number>> = {};
    for (const [tf, series] of Object.entries(candles) as [Timeframe, Candle[] | undefined][]) {
      if (series) bars[tf] = series.length;
    }

    const payload: BacktestResponse = {
      request: parsed.request,
      report,
      stride,
      bars,
      status: mtf.status,
      source,
      coverage: await coverageFor(asset.symbol, timeframe),
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
