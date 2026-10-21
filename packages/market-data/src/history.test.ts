import assert from "node:assert/strict";
import type { Candle, DataStatus, Timeframe } from "@atc/types";
import { TIMEFRAME_SECONDS } from "@atc/types";

import { backfillCandles, barsForDays, planBackfill } from "./history";
import { buildStatus } from "./types";

/**
 * Walking a feed backwards for months of history.
 *
 * The backtest was capped at four days because it shared the scan's cache
 * entry, and the way out is to page: ask for the newest bars, then ask again
 * for the window ending where that page started. Every provider caps a single
 * response and every provider hides a different depth limit behind it, so the
 * loop cannot be written against a table of constants — it has to stop when
 * the feed stops yielding, whatever the reason.
 *
 * Which makes the stopping conditions the whole correctness of this file, and
 * three of them are failures that do not look like failures:
 *
 *  - a feed that ignores the window returns the same page forever
 *  - a feed that has run out returns its oldest page forever
 *  - a feed that fails on page four must not discard pages one to three,
 *    because on the metered provider those were paid for
 *
 * The first two spin a `while` loop until the process dies or, on the metered
 * feed, until the daily allowance is gone — 800 credits burned in a loop that
 * never terminates. They are why `providerWall` is detected by comparing what
 * arrived against the cursor, rather than by trusting the feed to say so.
 */

let passed = 0;
async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed++;
  process.stdout.write(`  ok ${name}\n`);
}

function test(name: string, fn: () => void): void {
  fn();
  passed++;
  process.stdout.write(`  ok ${name}\n`);
}

const TF: Timeframe = "15m";
const BAR = TIMEFRAME_SECONDS[TF];
const NOW = 1_700_000_000;

function status(candles: Candle[], provider = "fake"): DataStatus {
  return buildStatus({ quality: "LIVE", provider, candles });
}

/** A series of `total` bars ending at NOW, oldest first. */
function series(total: number): Candle[] {
  return Array.from({ length: total }, (_, i) => {
    const time = NOW - (total - 1 - i) * BAR;
    return { time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 0 };
  });
}

/**
 * A feed with a finite history and a per-call ceiling — i.e. every real
 * provider. Serves the newest `limit` bars at or before `endTime`.
 */
function feed(options: { history: Candle[]; ceiling: number }) {
  const calls: { limit: number; endTime: number | undefined }[] = [];
  return {
    calls,
    fetchPage: async ({ limit, endTime }: { limit: number; endTime?: number }) => {
      calls.push({ limit, endTime });
      const eligible = options.history.filter((c) => endTime === undefined || c.time <= endTime);
      const page = eligible.slice(-Math.min(limit, options.ceiling));
      return { candles: page, status: status(page) };
    },
  };
}

async function run(): Promise<void> {
  await testAsync("months of history are assembled from pages no single call could return", async () => {
    // 5,000 bars from a feed that returns 1,000 at a time is the Binance case.
    const f = feed({ history: series(5000), ceiling: 1000 });
    const result = await backfillCandles({
      timeframe: TF,
      targetBars: 5000,
      pageSize: 1000,
      maxPages: 12,
      fetchPage: f.fetchPage,
    });

    assert.equal(result.stopped, "target");
    assert.equal(result.candles.length, 5000, "every bar in the history must arrive");
    assert.ok(result.pages > 1, "a 5,000-bar target cannot be one call at a 1,000 ceiling");
  });

  await testAsync("the bar where two pages meet is stored once, not twice", async () => {
    // Measured against the live API: asking for the window ending at a page's
    // oldest bar returns that same bar again as the next page's newest. A
    // backtest fed the duplicate settles a trade on it twice and reports a
    // sample larger than the market actually offered.
    const f = feed({ history: series(2500), ceiling: 1000 });
    const result = await backfillCandles({
      timeframe: TF,
      targetBars: 2500,
      pageSize: 1000,
      fetchPage: f.fetchPage,
    });

    const times = result.candles.map((c) => c.time);
    assert.equal(new Set(times).size, times.length, "a bar must never appear twice");
    for (let i = 1; i < times.length; i++) {
      assert.ok(times[i]! > times[i - 1]!, "the series must come back strictly ascending");
    }
  });

  await testAsync("a feed that has run out ends the walk instead of being asked forever", async () => {
    // The real stopping condition. This history is shorter than the target, so
    // a loop that only watched `targetBars` would ask for the same oldest page
    // until the page budget ran out -- free here, one credit a time on gold.
    const f = feed({ history: series(1500), ceiling: 1000 });
    const result = await backfillCandles({
      timeframe: TF,
      targetBars: 10_000,
      pageSize: 1000,
      maxPages: 20,
      fetchPage: f.fetchPage,
    });

    assert.equal(result.stopped, "providerWall", "running out of history is not running out of pages");
    assert.equal(result.candles.length, 1500, "what exists is kept");
    assert.ok(result.pages <= 3, `stopped promptly, took ${result.pages} pages`);
  });

  await testAsync("a feed that ignores the window is detected rather than looped on", async () => {
    // Yahoo honours period1/period2; a provider added later might not, and the
    // failure is silent -- every page returns the newest bars again, the
    // cursor never moves, and the loop spends the whole page budget to collect
    // one page of data. The guard is that the oldest bar did not get older.
    let calls = 0;
    const fixed = series(1000);
    const result = await backfillCandles({
      timeframe: TF,
      targetBars: 10_000,
      pageSize: 1000,
      maxPages: 20,
      fetchPage: async () => {
        calls++;
        return { candles: fixed, status: status(fixed) };
      },
    });

    assert.equal(result.stopped, "providerWall");
    assert.ok(calls <= 2, `a window-blind feed must be caught on the second page, took ${calls}`);
    assert.equal(result.candles.length, 1000);
  });

  await testAsync("a window-blind feed on a live market cannot walk the cursor forwards", async () => {
    // The nastier half of the same fault, and the reason "nothing new arrived"
    // is not a sufficient guard on its own. A feed that ignores the window
    // while the market is *open* returns a different page every call -- the
    // head has ticked, so one genuinely new bar arrives each time and the
    // collection keeps growing. The walk therefore never looks stuck, but its
    // oldest bar is getting *newer*, so it is paying a credit a page to crawl
    // in the wrong direction. Caught by comparing against the cursor.
    let calls = 0;
    const live = series(1200);
    const result = await backfillCandles({
      timeframe: TF,
      targetBars: 10_000,
      pageSize: 1000,
      maxPages: 20,
      fetchPage: async () => {
        calls++;
        // Newest 1000 bars of a feed whose head advanced while we paged.
        const page = live.slice(calls, calls + 1000);
        return { candles: page, status: status(page) };
      },
    });

    assert.equal(result.stopped, "providerWall");
    assert.ok(calls <= 2, `a cursor that moves forwards must end the walk at once, took ${calls}`);
  });

  await testAsync("pages already paid for survive a failure on a later one", async () => {
    // The metered case. Three pages succeeded and cost three credits; throwing
    // them away because the fourth timed out spends the credits twice to end
    // up with the same history.
    let call = 0;
    const history = series(5000);
    const result = await backfillCandles({
      timeframe: TF,
      targetBars: 5000,
      pageSize: 1000,
      maxPages: 12,
      fetchPage: async ({ limit, endTime }) => {
        call++;
        if (call === 4) throw new Error("free-tier credits exhausted");
        const eligible = history.filter((c) => endTime === undefined || c.time <= endTime);
        const page = eligible.slice(-limit);
        return { candles: page, status: status(page) };
      },
    });

    assert.equal(result.stopped, "error");
    assert.match(result.reason ?? "", /credits exhausted/);
    assert.ok(result.candles.length >= 2900, `kept the earlier pages, got ${result.candles.length}`);
  });

  await testAsync("the page budget caps the spend even when the feed would keep going", async () => {
    // Separate from the provider wall on purpose: one says "this is all the
    // history there is", the other says "this is all we chose to buy". A UI
    // that showed them the same way would report a budget decision as a
    // limitation of the market.
    const f = feed({ history: series(50_000), ceiling: 1000 });
    const result = await backfillCandles({
      timeframe: TF,
      targetBars: 50_000,
      pageSize: 1000,
      maxPages: 3,
      fetchPage: f.fetchPage,
    });

    assert.equal(result.stopped, "pageLimit");
    assert.equal(result.pages, 3, "the budget is a hard stop");
    assert.ok(result.candles.length < 50_000);
  });

  await testAsync("no page ever asks for more than the provider will return", async () => {
    // Over-asking does not error, it silently truncates -- and on the metered
    // feed the discarded surplus still costs a full credit.
    const f = feed({ history: series(5000), ceiling: 1000 });
    await backfillCandles({
      timeframe: TF,
      targetBars: 5000,
      pageSize: 1000,
      maxPages: 12,
      fetchPage: f.fetchPage,
    });

    for (const call of f.calls) {
      assert.ok(call.limit <= 1000, `asked for ${call.limit} from a feed that returns 1000`);
    }
  });

  await testAsync("the first page asks for the newest bars, not a window", async () => {
    // Providers size their own lookback differently for a windowed request, so
    // an endTime of "now" on the opening page is not the same as no endTime.
    const f = feed({ history: series(3000), ceiling: 1000 });
    await backfillCandles({ timeframe: TF, targetBars: 3000, pageSize: 1000, fetchPage: f.fetchPage });

    assert.equal(f.calls[0]?.endTime, undefined, "the opening page must be unwindowed");
    assert.ok(f.calls[1]?.endTime !== undefined, "every page after it must be windowed");
  });

  test("depth is sized by the calendar, not by a guess at the market's week", () => {
    // This test asserts the opposite of what it originally did, because the
    // measurement overturned the model. The first version discounted weekends
    // for gold and FX on the obvious grounds that they stop trading Friday
    // evening. Counting the bars TwelveData actually returned for XAU/USD 15m
    // -- Sun 1152, Mon 1152, Tue 1231, Wed 1238, Thu 1152, Fri 1152, Sat 1152
    // -- the feed prints straight through the weekend, and the discount
    // delivered 86 days of gold where 120 were asked for.
    //
    // The reason to size generously in general is that the two errors are not
    // symmetric. Over-asking is self-correcting: the walk runs out, the wall
    // is reported, the user learns the real limit. Under-asking silently
    // returns a third less history than requested and says nothing.
    const days = 120;
    const bars = barsForDays("15m", days);

    assert.equal(bars, Math.ceil((86400 / TIMEFRAME_SECONDS["15m"]) * days));
    assert.equal(bars * TIMEFRAME_SECONDS["15m"], days * 86400, "the ask must span the calendar");

    // Every timeframe must cover the same span, or a deep 15m archive would
    // sit beside a 4H one that runs out months earlier.
    for (const tf of ["5m", "15m", "1h", "4h"] as Timeframe[]) {
      const covered = (barsForDays(tf, days) * TIMEFRAME_SECONDS[tf]) / 86400;
      assert.ok(covered >= days, `${tf} covers only ${covered} of ${days} days`);
    }
  });

  test("an empty archive asks for everything and a warm one asks for the gap", () => {
    // What makes a second press cheap. Re-running the whole walk every time
    // would cost the same credits on every visit, which is exactly the trap
    // the four-day cap existed to avoid in the first place.
    const cold = planBackfill({
      storedBars: 0,
      storedNewest: null,
      storedOldest: null,
      targetBars: 8000,
      timeframe: TF,
      now: NOW,
    });
    assert.equal(cold.head, 8000, "nothing stored means the whole target");
    assert.equal(cold.tail, 0, "there is nothing to walk back from yet");
    assert.equal(cold.tailFrom, null);

    const warm = planBackfill({
      storedBars: 8000,
      storedNewest: NOW - 4 * BAR,
      storedOldest: NOW - 8000 * BAR,
      targetBars: 8000,
      timeframe: TF,
      now: NOW,
    });
    // Four bars closed, plus the one that was still open when it was stored.
    assert.equal(warm.head, 5, "a day later is a handful of bars, not another 8,000");
    assert.equal(warm.tail, 0, "a full archive has no tail left to buy");
    assert.ok(warm.head < cold.head / 100, "catching up must be orders of magnitude cheaper");
  });

  test("a current archive re-reads its newest bar, which was open when stored", () => {
    // The bar at the head of any fetch is usually still forming: its high, low
    // and close are not final. Stored once and never revisited, every later
    // backtest settles trades against a partial candle -- and because the open
    // time is already occupied, no amount of re-running fixes it.
    const plan = planBackfill({
      storedBars: 8000,
      storedNewest: NOW - BAR,
      storedOldest: NOW - 8000 * BAR,
      targetBars: 8000,
      timeframe: TF,
      now: NOW,
    });
    assert.equal(plan.head, 2, "one new bar, plus the unfinished one it replaces");

    const idle = planBackfill({
      storedBars: 8000,
      storedNewest: NOW,
      storedOldest: NOW - 8000 * BAR,
      targetBars: 8000,
      timeframe: TF,
      now: NOW,
    });
    assert.equal(idle.head, 0, "nothing has closed, so a press must not cost a credit");
  });

  test("a half-filled archive deepens from its oldest bar instead of sticking", () => {
    // The failure this shape exists to prevent, and it is not a small one. A
    // single shortfall number sends a newest-first walk that re-buys the bars
    // already stored: measured, a 2,000-bar archive climbs to 6,352 against an
    // 8,352-bar target and then sticks there forever, spending credits on
    // every press and never getting deeper. Worse than having no archive.
    const target = 8352;
    const oldest = NOW - 2000 * BAR;
    const plan = planBackfill({
      storedBars: 2000,
      storedNewest: NOW,
      storedOldest: oldest,
      targetBars: target,
      timeframe: TF,
      now: NOW,
    });

    assert.equal(plan.head, 0, "the archive is current, so nothing is owed at the head");
    assert.equal(plan.tail, target - 2000, "the tail walk buys exactly what is missing");
    assert.equal(plan.tailFrom, oldest, "and it starts where the stored history ends");

    // Pressing again must converge rather than repeat. Each press deepens the
    // archive by what the previous one bought.
    let stored = 2000;
    let from = oldest;
    let presses = 0;
    while (stored < target && presses < 10) {
      const next = planBackfill({
        storedBars: stored,
        storedNewest: NOW,
        storedOldest: from,
        targetBars: target,
        timeframe: TF,
        now: NOW,
      });
      if (next.tail === 0) break;
      // A page budget means one press may only deliver part of the tail.
      const delivered = Math.min(next.tail, 2000);
      stored += delivered;
      from -= delivered * BAR;
      presses++;
    }
    assert.equal(stored, target, `an interrupted backfill must converge, reached ${stored}`);
    assert.ok(presses <= 4, `and converge quickly, took ${presses} presses`);
  });

  test("a press that catches up and deepens at once does not buy the overlap twice", () => {
    // The two walks meet in the middle and the arithmetic has to account for
    // that. An archive left for a day is behind at the head *and* short at the
    // tail, so the head walk will deliver `missed` bars during this same
    // press -- measuring the tail against what is stored *now* orders those
    // same bars a second time from the other end.
    //
    // It is the quiet kind of wrong: nothing fails, the archive ends up the
    // right depth, and the user is simply charged for a page they already
    // bought. On the metered feed that is the difference between "free after
    // the first press" and "a little more every visit", which is the promise
    // this whole archive exists to keep.
    const target = 8352;
    const missed = 96; // a day of 15m bars
    const plan = planBackfill({
      storedBars: 2000,
      storedNewest: NOW - missed * BAR,
      storedOldest: NOW - 2096 * BAR,
      targetBars: target,
      timeframe: TF,
      now: NOW,
    });

    assert.equal(plan.head, missed + 1, "the head owes the closed bars plus the open one");
    assert.equal(
      plan.tail,
      target - (2000 + missed),
      "the tail must be measured against what the archive will hold once the head lands",
    );
    // The `+1` is the re-read of the bar that was still open when stored, and
    // is the only bar this press is allowed to pay for twice.
    assert.equal(
      2000 + plan.head + plan.tail,
      target + 1,
      "the two walks together must buy the target exactly once",
    );
  });

  await testAsync("a tail walk starts at the stored edge rather than the feed's head", async () => {
    // What makes resuming cheap rather than merely possible: the deepening
    // walk must not re-fetch the newest bars, because on the metered feed
    // those are credits spent re-buying rows the database already holds.
    const f = feed({ history: series(5000), ceiling: 1000 });
    const edge = NOW - 2000 * BAR;
    const result = await backfillCandles({
      timeframe: TF,
      targetBars: 1500,
      pageSize: 1000,
      startAt: edge,
      fetchPage: f.fetchPage,
    });

    assert.equal(f.calls[0]?.endTime, edge, "the opening page must be windowed at the stored edge");
    const newest = result.candles[result.candles.length - 1]?.time;
    assert.equal(newest, edge, "and must not return anything newer than it");
    assert.ok(result.candles.length >= 1500, `got ${result.candles.length} bars of tail`);
  });
}

run().then(
  () => {
    process.stdout.write(`history.test.ts: ${passed} history backfill guards passed\n`);
  },
  (error: unknown) => {
    process.stderr.write(
      `history.test.ts failed: ${error instanceof Error ? error.stack : String(error)}\n`,
    );
    process.exitCode = 1;
  },
);
