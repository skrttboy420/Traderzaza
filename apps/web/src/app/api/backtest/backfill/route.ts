import { NextResponse } from "next/server";
import { barsForDays, planBackfill } from "@atc/market-data";

import { archiveConfigured, archiveCoverage, writeCandles } from "@/lib/candle-archive";
import { marketService, scanTimeframes } from "@/lib/scan";
import {
  BACKTEST_DEPTH_DAYS,
  parseBacktestRequest,
  type BackfillFrame,
  type BackfillResponse,
} from "@/lib/backtest";

export const dynamic = "force-dynamic";

/**
 * The platform ceiling, matching every other route here.
 *
 * This was 300 for one draft, on the reasoning that a cold fill of four
 * timeframes can genuinely take minutes when the metered feed throttles to 8
 * credits a minute. That was the wrong lever. 300 is above what the Hobby plan
 * grants, so the number would have been clamped or rejected at deploy and the
 * run killed mid-walk anyway — and a run killed by the platform returns a
 * network error, losing the report of what *did* land even though the bars
 * themselves were already committed.
 *
 * The right lever is `RUN_BUDGET_MS`: stop before the platform does, and say
 * so. `planBackfill` makes that safe — a press that stops early is not a
 * failure, it is progress the next press continues from.
 */
export const maxDuration = 60;

/**
 * Wall-clock a single press may spend before it stops volunteering for more
 * work.
 *
 * Deliberately short of `maxDuration`, because the two failure modes are not
 * comparable. Stopping at the budget returns a complete report: which frames
 * filled, which did not, and a `deadline` marker telling the user to press
 * again. Being cut off at the platform deadline returns a network error — the
 * bars written so far survive, but nothing on screen says so, and the obvious
 * reading is that the whole press failed.
 *
 * The margin absorbs what happens *after* the loop: a coverage read, and the
 * response itself. Measured on the slow path — gold's four-frame top-up, with
 * the metered limiter engaged — a press lands in about 19s, so this only ever
 * bites on a cold fill of the deepest frames.
 */
const RUN_BUDGET_MS = 45_000;

/**
 * Upstream calls one timeframe may spend.
 *
 * This is the spend limit, and it is per-timeframe rather than per-run because
 * the frames are wildly unequal: four months of 4H is one page and four months
 * of 5M is thirty. A single run-wide budget would be either too small for 5M
 * or large enough to be meaningless for 4H.
 *
 * It is also the thing standing between a misconfigured provider and the daily
 * allowance. A feed that silently ignored the window would be caught by the
 * backfill's own wall detection after two pages — but a feed that returns one
 * genuinely older bar per call would not, and this is what stops that costing
 * 800 credits.
 */
const MAX_PAGES_PER_FRAME = 40;

/**
 * POST /api/backtest/backfill?symbol=XAUUSD&timeframe=15m
 *
 * Walks every timeframe the backtest reads back to `BACKTEST_DEPTH_DAYS` and
 * writes the bars down. This is the expensive press, and it is deliberately a
 * separate one: the user chooses when to spend, sees the result, and every
 * backtest afterwards reads the archive for free.
 *
 * POST rather than GET because it spends money and mutates storage. A GET
 * would be prefetched by the browser, retried by proxies, and re-run by every
 * crawler that found the URL.
 *
 * The whole chain is filled, not just the entry timeframe. `backtest` hands
 * the engine all four frames at every step, so an archive deep in 15M and
 * shallow in 4H produces a run that starts months back with no higher-
 * timeframe context — a different engine from the one on screen, grading
 * itself favourably because it cannot see the trend it would have been
 * refused by.
 *
 * Each frame is reported separately. A run where 5M stopped at `pageLimit`
 * while the rest reached `target` is a real and useful outcome — press again
 * and it continues from where it stopped — and collapsing it into one
 * success/failure flag would hide that.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const parsed = parseBacktestRequest({
    symbol: url.searchParams.get("symbol"),
    timeframe: url.searchParams.get("timeframe"),
    mode: url.searchParams.get("mode"),
  });

  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  if (!archiveConfigured()) {
    // Not an error the user can fix from the UI, so say what is missing
    // rather than failing generically.
    return NextResponse.json(
      { error: "No database configured, so history cannot be stored." },
      { status: 503 },
    );
  }

  // No `requireAsset` here: `parseBacktestRequest` has already refused any
  // symbol the catalogue does not know, so a second lookup would only throw
  // on input that cannot reach this line.
  const { symbol, timeframe } = parsed.request;
  const service = marketService();
  const now = Math.floor(Date.now() / 1000);

  const before = service.creditSnapshot();
  const started = Date.now();
  const frames: BackfillFrame[] = [];

  try {
    // Sequential, not parallel. The metered feed allows 8 calls a minute and
    // the provider's own limiter is per-service; firing four chains at once
    // would spend the minute's allowance in a burst and leave the live
    // dashboard throttled behind this background job.
    for (const tf of scanTimeframes({ entryTimeframe: timeframe })) {
      const targetBars = barsForDays(tf, BACKTEST_DEPTH_DAYS);
      const stored = await archiveCoverage({ symbol, timeframe: tf });

      // Out of time. Report the frame rather than dropping it: a list missing
      // 5M looks like a bug, while a 5M row saying `deadline` says press
      // again — which is the true and actionable thing, because the next
      // press resumes from the bars this one already wrote.
      if (Date.now() - started > RUN_BUDGET_MS) {
        frames.push({ timeframe: tf, pages: 0, written: 0, stored: stored.bars, stopped: "deadline" });
        continue;
      }

      // Only buy what is missing, and buy it from the right end. The head gap
      // and the tail gap are at opposite ends of the series, so they are two
      // walks from two cursors; see `planBackfill` for what happens when they
      // are collapsed into one.
      const plan = planBackfill({
        storedBars: stored.bars,
        storedNewest: stored.newest,
        storedOldest: stored.oldest,
        targetBars,
        timeframe: tf,
        now,
      });

      let pages = 0;
      let written = 0;
      // Both walks must land before the frame is called finished, and the
      // honest summary is the *worst* of the two: a head that reached target
      // over a tail that hit the page budget is still a frame with history
      // missing, and reporting `target` would stop the user pressing again.
      let stopped: BackfillFrame["stopped"] | null = null;
      let reason: string | undefined;

      const walks: { targetBars: number; startAt?: number }[] = [];
      if (plan.head > 0) walks.push({ targetBars: plan.head });
      if (plan.tail > 0 && plan.tailFrom !== null) {
        walks.push({ targetBars: plan.tail, startAt: plan.tailFrom });
      }

      for (const walk of walks) {
        // Checked between the two walks as well as between frames. The tail
        // walk is the long one — thirty pages on 5M against the head's one —
        // so a frame that arrives with the budget nearly gone would otherwise
        // overrun it by minutes on the strength of a cheap head walk.
        if (Date.now() - started > RUN_BUDGET_MS) {
          // Same worst-of rule as below: a head walk that already reported
          // `pageLimit` or `error` keeps that reason, because it is the more
          // specific thing to tell the user. Only an otherwise-clean frame
          // gets relabelled as unfinished.
          if (stopped === null || stopped === "target") stopped = "deadline";
          break;
        }

        const walked = await service.backfill({
          symbol,
          timeframe: tf,
          targetBars: walk.targetBars,
          maxPages: MAX_PAGES_PER_FRAME,
          ...(walk.startAt !== undefined ? { startAt: walk.startAt } : {}),
        });
        pages += walked.pages;

        const write = await writeCandles({
          symbol,
          timeframe: tf,
          candles: walked.candles,
          quality: walked.status?.quality ?? "DEMO",
          provider: walked.status?.provider ?? null,
        });
        written += write.written;

        if (stopped === null || (stopped === "target" && walked.stopped !== "target")) {
          stopped = walked.stopped;
          reason = walked.reason;
        }
      }

      const after = await archiveCoverage({ symbol, timeframe: tf });
      const frame: BackfillFrame = {
        timeframe: tf,
        pages,
        written,
        stored: after.bars,
        stopped: stopped ?? "target",
      };
      if (reason !== undefined) frame.reason = reason;
      frames.push(frame);
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "backfill failed" },
      { status: 502 },
    );
  }

  const after = service.creditSnapshot();
  const coverage = await archiveCoverage({ symbol, timeframe });
  const days =
    coverage.newest !== null && coverage.oldest !== null
      ? Math.round((coverage.newest - coverage.oldest) / 86400)
      : 0;

  const payload: BackfillResponse = {
    request: parsed.request,
    frames,
    coverage: { bars: coverage.bars, days, configured: true },
    credits: before && after ? Math.max(0, after.dayUsed - before.dayUsed) : null,
    ranMs: Date.now() - started,
  };

  return NextResponse.json(payload);
}
