import assert from "node:assert/strict";

import { CreditBudget, TwelveDataProvider } from "./twelvedata";
import type { CandleRequest } from "./types";

/**
 * The feed contract: what this provider asks for, and how it reads the answer.
 *
 * TwelveData speaks in naive datetimes — `2026-10-20 06:35:00`, no offset, no
 * `Z` — in both directions. Unset, `timezone` governs the instrument's local
 * exchange time for the `start_date` it reads *and* for the `datetime` on every
 * row it writes, while `exchange_timezone` comes back null so nothing announces
 * which clock is in use. This provider parses those rows as UTC.
 *
 * That combination shipped once. `timezone=UTC` was sent only on sliced
 * requests, so historical windows were right and every chart and watchlist scan
 * was wrong: XAU/USD's exchange sits at UTC+11 under southern-hemisphere DST,
 * and gold candles arrived stamped eleven hours in the future. The prices were
 * correct to the cent — it was the clock on them that lied, which is the kind
 * of wrong that looks like working software. A newest bar dated tomorrow, a
 * "last update" counting backwards, and a staleness check measuring now against
 * a future time.
 *
 * It cannot be corrected downstream either, because the offset follows daylight
 * saving. So it is asked for, and the asking is pinned here.
 */

let passed = 0;
async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed++;
  process.stdout.write(`  ok ${name}\n`);
}

/** `2026-10-19 19:35:00` — the naive shape both directions use. */
function naive(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * A 5-minute bar that closed a moment ago, derived from the clock rather than
 * written down, so "this candle is not in the future" stays a live claim
 * instead of one that a fixed date would quietly stop making.
 */
const ROW_INSTANT = Math.floor(Date.now() / 300_000) * 300 - 300;
/** XAU/USD's exchange sits here under southern-hemisphere DST. */
const EXCHANGE_OFFSET_HOURS = 11;

/** The two labels the same instant can wear. */
const UTC_LABEL = naive(ROW_INSTANT);
const EXCHANGE_LABEL = naive(ROW_INSTANT + EXCHANGE_OFFSET_HOURS * 3600);

const BASE_REQUEST: CandleRequest = { symbol: "XAUUSD", timeframe: "5m", limit: 200 };

/**
 * Captures the outgoing URL and replies the way the real endpoint does: the
 * label on the row depends on what the request asked for. An unpinned
 * `timezone` yields the exchange-local label — the same instant wearing a
 * different clock — which is exactly the condition that shipped. Without this,
 * the stand-in would answer identically either way and the assertions below
 * about the parsed time could not fail.
 */
async function capture(request: CandleRequest): Promise<{ url: URL; candleTime: number }> {
  const original = globalThis.fetch;
  let seen: string | null = null;

  globalThis.fetch = (async (input: string | URL | Request) => {
    seen = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const asked = new URL(seen).searchParams.get("timezone");
    const datetime = asked === "UTC" ? UTC_LABEL : EXCHANGE_LABEL;
    return new Response(
      JSON.stringify({
        status: "ok",
        values: [
          { datetime, open: "4142", high: "4143", low: "4141", close: "4142.38", volume: "0" },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const provider = new TwelveDataProvider(
      "test-key",
      "DELAYED",
      undefined,
      new CreditBudget({ perMinute: 10, perDay: 10 }),
    );
    const response = await provider.fetchCandles(request);
    assert.ok(seen, "the provider must have made a request");
    return { url: new URL(seen), candleTime: response.candles[0]?.time ?? 0 };
  } finally {
    globalThis.fetch = original;
  }
}

async function run(): Promise<void> {
  await testAsync("a plain chart request pins the timezone to UTC", async () => {
    // The regression. This is the request every chart and every watchlist scan
    // makes, and it is the one that used to go out without a timezone.
    const { url } = await capture(BASE_REQUEST);
    assert.equal(url.searchParams.get("start_date"), null, "this request is not a historical slice");
    assert.equal(
      url.searchParams.get("timezone"),
      "UTC",
      "an unpinned timezone returns exchange-local labels that this provider then reads as UTC",
    );
  });

  await testAsync("a historical slice pins it too", async () => {
    const { url } = await capture({ ...BASE_REQUEST, startTime: ROW_INSTANT - 3600, endTime: ROW_INSTANT });
    assert.ok(url.searchParams.get("start_date"), "this request is a historical slice");
    assert.equal(url.searchParams.get("timezone"), "UTC");
  });

  await testAsync("a returned row is read as the instant it names in UTC", async () => {
    const { candleTime } = await capture(BASE_REQUEST);
    assert.equal(candleTime, ROW_INSTANT, `${UTC_LABEL} is ${ROW_INSTANT} and nothing else`);
  });

  await testAsync("no candle is ever dated into the future", async () => {
    // The symptom the bug actually presented as, asserted directly: whatever
    // the timezone handling is doing, a bar that has closed cannot be newer
    // than now. Eleven hours of future-dated gold would fail here.
    const { candleTime } = await capture(BASE_REQUEST);
    const now = Math.floor(Date.now() / 1000);
    assert.ok(
      candleTime <= now,
      `a closed candle dated ${candleTime - now}s in the future means the label was read on the wrong clock`,
    );
  });
}

run().then(
  () => {
    process.stdout.write(`twelvedata.test.ts: ${passed} feed-contract guards passed\n`);
  },
  (error: unknown) => {
    process.stderr.write(
      `twelvedata.test.ts failed: ${error instanceof Error ? error.stack : String(error)}\n`,
    );
    process.exitCode = 1;
  },
);
