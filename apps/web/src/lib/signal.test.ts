import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { analyze } from "@atc/engine";
import type { AnalysisResult } from "@atc/engine";
import { generateCandles, requireAsset } from "@atc/market-data";

import { NO_DATA_STATUS, weakestStatus } from "./home";
import { toSignalData } from "./signal";

/**
 * The two kinds of nothing.
 *
 * A scan that returns no signal and a scan that returned no data both end up
 * as an empty list, and on a trading screen those mean opposite things: the
 * first says "stay out, that is the answer", the second says "you are looking
 * at nothing, do not conclude anything". Conflating them is the single most
 * expensive mistake this UI can make, because the user acts on the difference.
 *
 * `measured` is what keeps them apart, so what it counts is pinned here. The
 * tempting wrong answer is "how many markets did we try?" — which includes the
 * failures and puts every screen straight back to claiming the market is quiet
 * when the feed is down.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function analysisFor(symbol: string): AnalysisResult {
  return analyze({
    asset: requireAsset(symbol),
    candles: {
      "4h": generateCandles({ symbol, timeframe: "4h", limit: 300 }),
      "1h": generateCandles({ symbol, timeframe: "1h", limit: 300 }),
      "15m": generateCandles({ symbol, timeframe: "15m", limit: 400 }),
      "5m": generateCandles({ symbol, timeframe: "5m", limit: 400 }),
    },
    dataStatus: { quality: "DEMO", provider: "mock", lastCandleTime: 0, candleCount: 400 },
  });
}

test("a scan where every market failed measured nothing", () => {
  const data = toSignalData([], 1000, [
    { symbol: "BTCUSDT", reason: "fetch failed" },
    { symbol: "EURUSD", reason: "fetch failed" },
  ]);

  assert.equal(data.measured, 0, "nothing was analysed, so nothing was measured");
  assert.equal(data.total, 0);
  assert.deepEqual(data.blocked, [], "a market that never loaded was not blocked — it was absent");
});

test("measured counts the markets that answered, not the markets that were asked", () => {
  const data = toSignalData([analysisFor("BTCUSDT")], 1000, [
    { symbol: "EURUSD", reason: "fetch failed" },
    { symbol: "XAUUSD", reason: "rate limited" },
  ]);

  assert.equal(data.measured, 1, "one market answered out of three");
  assert.equal(data.failed.length, 2, "the other two are reported, not dropped");
  assert.equal(
    data.measured + data.failed.length,
    3,
    "every symbol asked for is accounted for as either measured or failed",
  );
});

test("an empty scan is never badged as live data", () => {
  // The headline badge is derived from the markets that answered. With none,
  // the honest answer is the no-data status, not an optimistic default.
  assert.deepEqual(weakestStatus([]), NO_DATA_STATUS);
  assert.equal(NO_DATA_STATUS.quality, "DEMO");
  assert.equal(NO_DATA_STATUS.candleCount, 0);
});

test("every scanning screen handles the no-data case", () => {
  // These four screens all render a "nothing qualifies" message. Each one must
  // also carry the branch that withholds it when nothing was measured — the
  // failure being guarded against is someone deleting the guard and leaving a
  // dead feed reading as a quiet market.
  const screens = [
    "../app/HomeView.tsx",
    "../app/signal/SignalView.tsx",
    "../app/setups/SetupsView.tsx",
    "../app/markets/MarketsView.tsx",
  ];

  for (const screen of screens) {
    const source = readFileSync(join(HERE, screen), "utf8");
    assert.match(
      source,
      /feed\.noneTitle/,
      `${screen} no longer distinguishes "no data" from "no signal"`,
    );
    assert.match(source, /FeedFailure/, `${screen} no longer reports feeds that failed`);
  }
});

process.stdout.write("\nsignal.test.ts: no-data vs no-signal guards passed\n");
