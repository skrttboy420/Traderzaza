import assert from "node:assert/strict";
import test from "node:test";
import type { Candle } from "@atc/types";

import { coverageFrom, readCandlesFrom, writeCandlesTo, type ArchiveClient } from "./candle-archive";

/**
 * The archive's two silent failure modes.
 *
 * Neither of these throws, neither shows on a screen, and both turn the whole
 * deep-history feature into a lie that reports success:
 *
 *  - Supabase caps a response at 1,000 rows and does not say so. A read that
 *    took the first page as the whole archive would hand four months back as
 *    four days — and a shallow backtest is indistinguishable from a quiet
 *    market, which is the exact confusion this feature exists to remove.
 *  - A write that abandoned the chunks it had already committed would report
 *    zero bars stored for bars that are in the table and were paid for, and
 *    the next press would buy them again.
 *
 * Both are properties of the paging arithmetic rather than of the database, so
 * they are tested against a fake that records what was asked for. The fake
 * models only what these functions call; it is deliberately not a Supabase
 * emulator, because a fake elaborate enough to drift is worse than none.
 */

interface Ask {
  table: string;
  columns: string;
  eq: [string, string][];
  order: [string, boolean][];
  limit: number | null;
  range: [number, number] | null;
  count: boolean;
}

interface Fake {
  client: ArchiveClient;
  /** Every select, in order, so paging can be inspected rather than inferred. */
  reads: Ask[];
  /** Every upsert's row count, in order. */
  writes: number[];
}

/**
 * A client that answers reads from `rows` and records how they were asked for.
 *
 * `pageCap` is the thing under test: the fake truncates every response to it,
 * exactly as PostgREST does, so a reader that fails to page sees a short
 * archive and no error — the real failure, reproduced.
 */
function fake(options: {
  rows?: { open_time: number }[];
  pageCap?: number;
  /** Fail the upsert that starts at this row index. */
  failWriteAt?: number;
  /** Throw from the nth select (1-based), as an unreachable database would. */
  throwOnRead?: number;
}): Fake {
  const rows = options.rows ?? [];
  const pageCap = options.pageCap ?? 1000;
  const reads: Ask[] = [];
  const writes: number[] = [];
  let writeCursor = 0;

  const client: ArchiveClient = {
    from(table) {
      return {
        select(columns, selectOptions) {
          const ask: Ask = {
            table,
            columns,
            eq: [],
            order: [],
            limit: null,
            range: null,
            count: selectOptions?.count === "exact",
          };
          reads.push(ask);

          const settle = () => {
            // Thrown, not returned as `{ error }`. A dropped connection and a
            // DNS failure arrive this way, and the difference matters: a
            // returned error is handled by the loop, a thrown one is only
            // handled if the function catches.
            if (options.throwOnRead !== undefined && reads.length === options.throwOnRead) {
              throw new Error("unreachable");
            }

            // Descending by open_time is the only order these functions use
            // for bars; coverage also asks ascending for the oldest.
            const descending = ask.order.some(([column, asc]) => column === "open_time" && !asc);
            const sorted = [...rows].sort((a, b) =>
              descending ? b.open_time - a.open_time : a.open_time - b.open_time,
            );

            let window = sorted;
            if (ask.range) window = sorted.slice(ask.range[0], ask.range[1] + 1);
            if (ask.limit !== null) window = window.slice(0, ask.limit);

            return {
              data: window.slice(0, pageCap),
              error: null,
              count: ask.count ? rows.length : null,
            };
          };

          const query = {
            eq(column: string, value: string) {
              ask.eq.push([column, value]);
              return query;
            },
            order(column: string, orderOptions: { ascending: boolean }) {
              ask.order.push([column, orderOptions.ascending]);
              return query;
            },
            limit(n: number) {
              ask.limit = n;
              return query;
            },
            range(from: number, to: number) {
              ask.range = [from, to];
              return query;
            },
            then<R>(resolve: (value: ReturnType<typeof settle>) => R) {
              return Promise.resolve(settle()).then(resolve);
            },
          };
          return query as never;
        },
        upsert(chunk: unknown[]) {
          const startsAt = writeCursor;
          writeCursor += chunk.length;
          if (options.failWriteAt !== undefined && startsAt === options.failWriteAt) {
            return Promise.resolve({ error: new Error("statement failed") });
          }
          writes.push(chunk.length);
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  return { client, reads, writes };
}

/** `n` bars at one-minute spacing, newest last. Only `open_time` matters here. */
function bars(n: number, from = 1_700_000_000): { open_time: number }[] {
  return Array.from({ length: n }, (_, i) => ({ open_time: from + i * 60 }));
}

function candles(n: number, from = 1_700_000_000): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    time: from + i * 60,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 10,
  }));
}

test("a read deeper than one response page returns the whole archive, not the first page", async () => {
  // Four months of 15m is ~11,500 bars; the cap is 1,000 and is not reported
  // as an error. Paging is the only thing standing between that and a
  // backtest that silently grades four days while claiming four months.
  const f = fake({ rows: bars(2_600), pageCap: 1000 });

  const got = await readCandlesFrom(f.client, { symbol: "XAUUSD", timeframe: "15m", limit: 2_600 });

  assert.equal(got.length, 2_600, "the archive was truncated at a response page");
  assert.equal(f.reads.length, 3, "2,600 bars at 1,000 a page is three reads");
});

test("every page asks for a window the one before it did not", async () => {
  // The failure this rules out is a loop that pages without moving: three
  // calls, same range, 1,000 distinct bars reported as 3,000.
  const f = fake({ rows: bars(2_600), pageCap: 1000 });

  await readCandlesFrom(f.client, { symbol: "XAUUSD", timeframe: "15m", limit: 2_600 });

  const ranges = f.reads.map((r) => r.range);
  assert.deepEqual(ranges, [
    [0, 999],
    [1000, 1999],
    [2000, 2599],
  ]);
});

test("the last page is sized to what was asked for, not rounded up to a full one", async () => {
  // Over-reading is not free: the surplus rows cross the wire and are then
  // discarded, on a path that runs on every backtest.
  const f = fake({ rows: bars(5_000), pageCap: 1000 });

  const got = await readCandlesFrom(f.client, { symbol: "BTCUSDT", timeframe: "5m", limit: 1_400 });

  assert.equal(got.length, 1_400);
  assert.deepEqual(f.reads.at(-1)?.range, [1000, 1399]);
});

test("an archive shallower than the request ends the walk instead of paging into nothing", async () => {
  // A cold or partly-filled archive is the normal case, not an error. Asking
  // for 11,520 bars when 1,200 are stored must cost two reads, not twelve.
  const f = fake({ rows: bars(1_200), pageCap: 1000 });

  const got = await readCandlesFrom(f.client, { symbol: "XAUUSD", timeframe: "15m", limit: 11_520 });

  assert.equal(got.length, 1_200);
  assert.equal(f.reads.length, 2, "a short page is the end of the archive");
});

test("bars come back oldest first, which is the only order the engine can read", async () => {
  // Read newest-first at the database — one seek off a descending index, no
  // matter how deep the archive gets — and reversed here. A backtest handed
  // a reversed series would replay the market backwards and report nonsense
  // without failing.
  const f = fake({ rows: bars(2_500), pageCap: 1000 });

  const got = await readCandlesFrom(f.client, { symbol: "XAUUSD", timeframe: "15m", limit: 2_500 });

  assert.ok(got.length > 0);
  for (let i = 1; i < got.length; i += 1) {
    assert.ok(got[i]!.time > got[i - 1]!.time, `bar ${i} is not newer than the one before it`);
  }
});

test("the newest bars are the ones returned, not the oldest", async () => {
  // A backtest wants the most recent window. Taking the oldest N would grade
  // the engine on last spring and look entirely normal doing it.
  const f = fake({ rows: bars(3_000), pageCap: 1000 });

  const got = await readCandlesFrom(f.client, { symbol: "XAUUSD", timeframe: "15m", limit: 500 });

  const newest = 1_700_000_000 + 2_999 * 60;
  assert.equal(got.at(-1)?.time, newest);
  assert.equal(got.length, 500);
});

test("an unreachable database reads as an empty archive rather than a thrown page", async () => {
  // The app is designed to run with an empty env file. A backtest that works
  // on the live window must not start crashing because storage is down.
  const f = fake({ rows: bars(2_000), throwOnRead: 1 });

  const got = await readCandlesFrom(f.client, { symbol: "XAUUSD", timeframe: "15m", limit: 2_000 });

  assert.deepEqual(got, []);
});

test("pages already read survive a failure on a later one", async () => {
  // Partial history is worth more than none: two thousand bars still settle
  // trades, and the caller can tell they are shallow from the count. Throwing
  // the lot away turns a flaky connection into "no archive" and sends the
  // backtest to the live window for the rest of the session.
  const f = fake({ rows: bars(2_600), pageCap: 1000, throwOnRead: 3 });

  const got = await readCandlesFrom(f.client, { symbol: "XAUUSD", timeframe: "15m", limit: 2_600 });

  assert.equal(got.length, 2_000, "the pages that arrived before the failure were discarded");
  for (let i = 1; i < got.length; i += 1) {
    assert.ok(got[i]!.time > got[i - 1]!.time, "a salvaged read came back out of order");
  }
});

test("bars already committed survive a failure on a later chunk", async () => {
  // The chunks before the failure are real rows in the table that credits
  // were spent on. Reporting zero would invite buying them a second time.
  const f = fake({ failWriteAt: 1000 });

  const result = await writeCandlesTo(f.client, {
    symbol: "XAUUSD",
    timeframe: "15m",
    candles: candles(1_600),
    quality: "LIVE",
    provider: "twelvedata",
  });

  assert.equal(result.ok, false, "a failed chunk is still a failed write");
  assert.equal(result.written, 1_000, "the two chunks that landed were not reported");
});

test("a write larger than one statement is split rather than sent whole", async () => {
  // Postgres has a parameter ceiling per statement and a candle is nine
  // columns. The error arrives after the credits were already spent fetching
  // the bars, which is the worst possible moment to find out.
  const f = fake({});

  const result = await writeCandlesTo(f.client, {
    symbol: "BTCUSDT",
    timeframe: "5m",
    candles: candles(1_250),
    quality: "LIVE",
    provider: "binance",
  });

  assert.equal(result.written, 1_250);
  assert.deepEqual(f.writes, [500, 500, 250]);
});

test("synthetic bars are refused, because the archive cannot tell them apart later", async () => {
  // DEMO prices are invented. Once written they occupy the open times a real
  // backfill would fill, so no later press replaces them, and every backtest
  // afterwards grades the engine against a market that never happened.
  const f = fake({});

  const result = await writeCandlesTo(f.client, {
    symbol: "XAUUSD",
    timeframe: "15m",
    candles: candles(100),
    quality: "DEMO",
    provider: "mock",
  });

  assert.equal(result.ok, false);
  assert.equal(result.written, 0);
  assert.deepEqual(f.writes, [], "demo bars reached the database");
});

test("coverage counts the archive without reading it", async () => {
  // The decision "do we need to spend credits" is made before any bar is
  // wanted. Pulling eleven thousand rows to count them would make checking
  // the archive as expensive as not having one.
  const f = fake({ rows: bars(11_520), pageCap: 1000 });

  const got = await coverageFrom(f.client, { symbol: "XAUUSD", timeframe: "15m" });

  assert.equal(got.bars, 11_520);
  assert.equal(got.newest, 1_700_000_000 + 11_519 * 60);
  assert.equal(got.oldest, 1_700_000_000);
  for (const read of f.reads) {
    assert.equal(read.limit, 1, "coverage pulled rows instead of asking for an edge");
  }
});

test("an empty archive reports no edges rather than inventing them", async () => {
  // `planBackfill` branches on these being null. A zero would read as "the
  // archive is current as of 1970" and plan a walk of millions of bars.
  const f = fake({ rows: [] });

  const got = await coverageFrom(f.client, { symbol: "ETHUSDT", timeframe: "1h" });

  assert.deepEqual(got, { bars: 0, newest: null, oldest: null });
});

test("coverage is asked for one series, not for the whole table", async () => {
  // Both filters, on every query, or the count is someone else's. The 5M
  // frame of a filled chain holds 34,558 bars against 15M's 11,520 — so a
  // dropped timeframe filter would report 15M as three times past its target,
  // `planBackfill` would ask for nothing, and the backfill button would do
  // nothing while insisting the archive was full. Silent, and permanent.
  const f = fake({ rows: bars(500) });

  await coverageFrom(f.client, { symbol: "XAUUSD", timeframe: "15m" });

  assert.ok(f.reads.length > 0);
  for (const read of f.reads) {
    assert.deepEqual(
      read.eq,
      [
        ["symbol", "XAUUSD"],
        ["timeframe", "15m"],
      ],
      "a coverage query was not narrowed to one symbol and timeframe",
    );
  }
});

test("a read is asked for one series, not for the whole table", async () => {
  // Same filter, same stakes, on the path that feeds the engine: bars from
  // another timeframe mixed into the series would be replayed as if they
  // belonged to it.
  const f = fake({ rows: bars(1_500), pageCap: 1000 });

  await readCandlesFrom(f.client, { symbol: "BTCUSDT", timeframe: "5m", limit: 1_500 });

  assert.ok(f.reads.length > 0);
  for (const read of f.reads) {
    assert.deepEqual(read.eq, [
      ["symbol", "BTCUSDT"],
      ["timeframe", "5m"],
    ]);
  }
});
