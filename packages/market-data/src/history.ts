import type { Candle, DataStatus, Timeframe } from "@atc/types";
import { TIMEFRAME_SECONDS } from "@atc/types";

/**
 * Paging backwards through a feed, which is the only way to get months of
 * history out of APIs that all cap a single response.
 *
 * Every provider here has a different ceiling and a different wall, and the
 * two are not the same thing. The *ceiling* is how many bars one call returns
 * — 1000 on Binance, 2000 on Yahoo, 5000 on TwelveData. The *wall* is how far
 * back the feed will go at all, and it is both undocumented and inconsistent:
 * measured on this deployment, TwelveData walks 15m gold back at least seven
 * months, while Yahoo refuses 15m beyond 60 days outright with a 422.
 *
 * So this does not encode any provider's limits. It asks for a page, moves
 * the cursor to the oldest bar it got, and asks again — and it stops when the
 * feed stops yielding anything older, whatever the reason. That makes the
 * stopping condition a *measurement* rather than a constant that goes stale
 * the next time an upstream changes its mind, and it means a provider that
 * silently ignores the window cannot spin this in a loop: the second page
 * comes back no older than the first, which reads as a wall and ends the run.
 */

export interface BackfillPage {
  candles: Candle[];
  status: DataStatus;
}

/**
 * Why the run ended. Reported rather than inferred because the four have
 * different meanings to the user and only one of them is a problem.
 *
 *  - `target`       got what was asked for
 *  - `providerWall` the feed has no more history; this is the real limit
 *  - `pageLimit`    we stopped spending before the feed did
 *  - `error`        a call failed; whatever arrived before it is kept
 */
export type BackfillStop = "target" | "providerWall" | "pageLimit" | "error";

export interface BackfillResult {
  /** Ascending by time, de-duplicated across page boundaries. */
  candles: Candle[];
  /** Upstream calls actually made. On a metered feed this is the bill. */
  pages: number;
  stopped: BackfillStop;
  /** Present when `stopped === "error"`. */
  reason?: string;
  /** From the newest page, so quality/provider describe the series head. */
  status: DataStatus | null;
}

export interface BackfillOptions {
  timeframe: Timeframe;
  /** How many bars we want in total. */
  targetBars: number;
  /** The provider's per-call ceiling. Asking for more than this wastes a call. */
  pageSize: number;
  /**
   * Hard stop on upstream calls, independent of how many bars arrive. This is
   * the spend limit: on the metered feed one page is one credit, and a loop
   * that only stopped on `targetBars` would keep paying for a timeframe whose
   * history is thinner than the caller assumed.
   */
  maxPages?: number;
  /**
   * Where the walk begins. Undefined asks the feed for its newest bars, which
   * is what a first fill wants; a time starts the walk there instead, which is
   * how an archive that is already current gets *deeper* without re-buying
   * every bar it already holds.
   */
  startAt?: number;
  /** Fetches one page ending at `endTime` (inclusive), newest page first. */
  fetchPage: (window: { limit: number; endTime?: number }) => Promise<BackfillPage>;
}

const DEFAULT_MAX_PAGES = 12;

export async function backfillCandles(options: BackfillOptions): Promise<BackfillResult> {
  const { timeframe, targetBars, pageSize, fetchPage } = options;
  const maxPages = Math.max(options.maxPages ?? DEFAULT_MAX_PAGES, 1);

  // Keyed by open time, which is what makes the overlap harmless. Pages abut
  // rather than tile: asking for the window ending at a page's oldest bar
  // returns that same bar again as the next page's newest. Measured, not
  // assumed — and a backtest fed a duplicated bar would settle a trade twice.
  const byTime = new Map<number, Candle>();

  let cursor: number | undefined = options.startAt;
  let pages = 0;
  let head: DataStatus | null = null;
  let stopped: BackfillStop = "pageLimit";
  let reason: string | undefined;

  while (pages < maxPages) {
    const remaining = targetBars - byTime.size;
    if (remaining <= 0) {
      stopped = "target";
      break;
    }

    let page: BackfillPage;
    try {
      // Never ask for more than the ceiling: the surplus is dropped upstream
      // and the call still costs the same.
      //
      // The `+1` is the overlap. A windowed page ends *at* the cursor and the
      // cursor is a bar we already hold, so one slot of every page after the
      // first buys nothing. Without it a walk lands exactly one bar short of
      // its target, asks one more time, gets back only the duplicate, and
      // reports `providerWall` — telling the user the market ran out of
      // history when what actually ran out was the arithmetic.
      const want = cursor === undefined ? remaining : remaining + 1;
      page = await fetchPage({ limit: Math.min(want, pageSize), endTime: cursor });
      pages += 1;
    } catch (error) {
      pages += 1;
      stopped = "error";
      reason = error instanceof Error ? error.message : "fetch failed";
      break;
    }

    // The head page describes the series as the app would see it live.
    if (head === null) head = page.status;

    const before = byTime.size;
    let oldest: number | null = null;
    for (const candle of page.candles) {
      byTime.set(candle.time, candle);
      if (oldest === null || candle.time < oldest) oldest = candle.time;
    }

    // Nothing older arrived. Either the feed has no more history, or it
    // ignored the window and handed back the page we already have. Both mean
    // the same thing to the caller and both must end the loop — the second
    // one silently, because a provider without windowing is not an error.
    if (oldest === null || byTime.size === before || (cursor !== undefined && oldest >= cursor)) {
      stopped = "providerWall";
      break;
    }

    cursor = oldest;
  }

  if (stopped === "pageLimit" && byTime.size >= targetBars) stopped = "target";

  const candles = [...byTime.values()].sort((a, b) => a.time - b.time);
  const result: BackfillResult = { candles, pages, stopped, status: head };
  if (reason !== undefined) result.reason = reason;
  return result;
}

/**
 * Bars needed to cover a calendar span.
 *
 * Deliberately *not* discounted for weekends, and that is a correction rather
 * than an oversight. The obvious model says gold and FX stop from Friday
 * evening to Sunday evening, so four months of 15m should be asked for as
 * five sevenths of the calendar. Counting the bars TwelveData actually
 * returned for XAU/USD 15m says otherwise — Sun 1152, Mon 1152, Tue 1231,
 * Wed 1238, Thu 1152, Fri 1152, Sat 1152 — the feed prints straight through
 * the weekend. The discount cost gold 86 days of history where 120 were
 * asked for: a 28% shortfall, on the market this app is mostly used for.
 *
 * The general reason to size generously is that the two errors are not
 * symmetric. Asking for more bars than a market printed is self-correcting:
 * the walk stops yielding, `providerWall` is reported, and the user is told
 * the real limit. Asking for fewer silently returns less history than was
 * requested and nothing anywhere says so. A feed that genuinely does gap at
 * weekends therefore costs at most one wasted page; a feed wrongly assumed to
 * gap costs a third of the history, invisibly.
 */
export function barsForDays(timeframe: Timeframe, days: number): number {
  return Math.ceil((86400 / TIMEFRAME_SECONDS[timeframe]) * days);
}

export interface BackfillPlan {
  /**
   * Bars to fetch starting from the feed's newest. Zero when the archive is
   * already current.
   */
  head: number;
  /**
   * Bars to fetch walking back from `tailFrom`. Zero when the archive already
   * reaches the target depth.
   */
  tail: number;
  /** Cursor for the tail walk; null when there is no tail walk to do. */
  tailFrom: number | null;
}

/**
 * What is still missing, as the two separate walks it actually takes.
 *
 * The obvious version of this returns one number — bars missed at the head
 * plus bars missing off the tail — and it does not work, because those two
 * gaps are at opposite ends of the series and a walk can only start at one of
 * them. A newest-first walk sized `head + tail` re-buys the bars already
 * stored and stops short of the target, so the next press computes the same
 * shortfall, buys the same bars, and stops in the same place. Measured on a
 * 2,000-bar archive against an 8,352-bar target: it climbs to 6,352 and then
 * sticks there, spending credits on every press forever without ever getting
 * deeper. That is strictly worse than not caching at all.
 *
 * So the gaps are reported separately:
 *
 *  - `head` is the catch-up, fetched newest-first. It is what makes a second
 *    visit cheap — a day later this is a single page, not a repeat of the run.
 *  - `tail` is the deepening, paged backwards from the oldest bar stored. It
 *    only buys history the archive does not have, so a backfill interrupted
 *    halfway resumes instead of restarting.
 *
 * A cold archive is all head and no tail: there is nothing to walk back from.
 */
export function planBackfill(params: {
  storedBars: number;
  storedNewest: number | null;
  storedOldest: number | null;
  targetBars: number;
  timeframe: Timeframe;
  now: number;
}): BackfillPlan {
  const { storedBars, storedNewest, storedOldest, targetBars, timeframe, now } = params;
  if (storedNewest === null || storedOldest === null || storedBars === 0) {
    return { head: targetBars, tail: 0, tailFrom: null };
  }

  // Bars that have closed since the archive's newest.
  const bar = TIMEFRAME_SECONDS[timeframe];
  const missed = Math.max(0, Math.floor((now - storedNewest) / bar));
  // The `+1` re-fetches the newest stored bar itself. It was almost certainly
  // still open when it was written — its high, low and close were not final —
  // and this is the press that replaces it with the settled version.
  const head = missed > 0 ? missed + 1 : 0;

  // Measured against what the archive will hold once the head walk lands, not
  // against what it holds now; otherwise a run that catches up and deepens in
  // the same press buys the overlap twice.
  const tail = Math.max(0, targetBars - (storedBars + missed));

  return { head, tail, tailFrom: tail > 0 ? storedOldest : null };
}
