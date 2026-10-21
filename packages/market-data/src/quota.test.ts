import assert from "node:assert/strict";
import { MTF_CHAIN } from "@atc/types";
import type { Candle } from "@atc/types";

import { CreditBudget, FREE_TIER_CREDITS, TwelveDataProvider } from "./twelvedata";
import { MarketDataService, candleTtlSeconds } from "./service";
import { buildStatus } from "./types";
import type { CandleRequest, CandleResponse, MarketDataProvider } from "./types";

/**
 * Living inside someone else's rate limit.
 *
 * The free TwelveData tier allows 8 credits a minute and 800 a day, and one
 * `time_series` call costs one credit. A watchlist scan loads the mandatory
 * 4H/1H/15M/5M chain, so gold alone costs four — half the minute's allowance
 * in a single page render, on an app where four separate screens scan and all
 * of them are `force-dynamic`.
 *
 * That arithmetic is the whole design, so it is pinned here rather than left
 * in a comment. Two things follow from it and both are tested: the budget must
 * refuse *before* spending a request it cannot afford, and when the feed is
 * unavailable the cache must hand back the last real candles instead of the
 * demo generator. Stale prices were genuinely traded; synthetic ones never
 * were, and on a screen showing entry and stop levels that difference is the
 * difference between a usable chart and a fictional one.
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

function candles(close: number): Candle[] {
  return [{ time: 1_700_000_000, open: close, high: close, low: close, close, volume: 0 }];
}

/** Counts calls so "did the cache actually prevent a request?" is observable. */
class CountingProvider implements MarketDataProvider {
  readonly name = "counting";
  readonly quality = "LIVE" as const;
  /** Mutable so the cost tests can price the same provider both ways. */
  metered = false;
  /** Mutable so the paging tests can force a page boundary cheaply. */
  maxBarsPerCall = 1000;
  calls = 0;
  fail = false;
  price = 100;

  supports(): boolean {
    return true;
  }

  async fetchCandles(): Promise<CandleResponse> {
    this.calls++;
    if (this.fail) throw new Error("feed down");
    return {
      candles: candles(this.price),
      status: buildStatus({ quality: "LIVE", provider: this.name, candles: candles(this.price) }),
    };
  }
}

/** A service whose clock the test owns, so TTL expiry does not need real time. */
class ClockedService extends MarketDataService {
  public clock = 1_000_000;
  protected override now(): number {
    return this.clock;
  }
}

const REQUEST: CandleRequest = { symbol: "XAUUSD", timeframe: "5m", limit: 100 };

test("one watchlist scan costs a full half of the per-minute allowance", () => {
  // The number that justifies every other line in this file. If the chain ever
  // grows, this fails and the caching strategy has to be revisited rather than
  // silently becoming inadequate.
  const creditsPerSymbolScan = MTF_CHAIN.length;
  assert.equal(creditsPerSymbolScan, 4);
  assert.equal(FREE_TIER_CREDITS.perMinute, 8);
  assert.equal(
    Math.floor(FREE_TIER_CREDITS.perMinute / creditsPerSymbolScan),
    2,
    "two uncached page loads a minute is the entire budget",
  );
});

test("the budget refuses the credit that would exceed the minute, then recovers", () => {
  const budget = new CreditBudget({ perMinute: 3, perDay: 100 });
  const t0 = Date.parse("2026-10-20T10:00:00Z");

  assert.equal(budget.tryConsume(t0), true);
  assert.equal(budget.tryConsume(t0 + 1000), true);
  assert.equal(budget.tryConsume(t0 + 2000), true);
  assert.equal(budget.tryConsume(t0 + 3000), false, "the fourth in a minute must be refused");

  // The window rolls, it does not reset on a fixed boundary: a credit stops
  // counting against the allowance once it is more than 60s old. At t0+61s the
  // ones from t0 and t0+1s have aged out and the t0+2s one has not, so the
  // minute reads 1 before this call and 2 after it — while the day keeps all 4.
  assert.equal(budget.tryConsume(t0 + 61_000), true);
  assert.deepEqual(budget.snapshot(t0 + 61_000), {
    minuteUsed: 2,
    minuteLimit: 3,
    dayUsed: 4,
    dayLimit: 100,
  });
});

test("the daily limit stops spending even when the minute is clear", () => {
  const budget = new CreditBudget({ perMinute: 100, perDay: 2 });
  const t0 = Date.parse("2026-10-20T10:00:00Z");

  assert.equal(budget.tryConsume(t0), true);
  assert.equal(budget.tryConsume(t0 + 120_000), true);
  assert.equal(budget.tryConsume(t0 + 240_000), false, "the day is spent");

  // A new UTC day is a new allowance.
  assert.equal(budget.tryConsume(Date.parse("2026-10-21T00:00:01Z")), true);
});

test("the cache lifetime scales with the bar, within bounds", () => {
  // A minute is most of a 5M bar's life and nothing at all on a 4H one, so the
  // lifetime is a fraction of the bar rather than one number for everything.
  assert.equal(candleTtlSeconds("5m"), 75);
  assert.equal(candleTtlSeconds("1h"), 900);
  assert.ok(candleTtlSeconds("1m") >= 15, "a floor stops per-render fetching on 1M");
  assert.ok(candleTtlSeconds("1d") <= 1800, "a ceiling stops a stale daily bar being trusted");

  // Higher divisor means fresher data and more requests.
  assert.ok(candleTtlSeconds("1h", 60) < candleTtlSeconds("1h", 4));
});

async function run(): Promise<void> {
  await testAsync("an exhausted budget fails without spending a request", async () => {
    // The point of checking first: a 429 discovered from the far end has already
    // cost the round trip. Nothing may reach the network once the budget is out.
    const original = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = (async () => {
      requests++;
      throw new Error("the test must never reach here");
    }) as typeof fetch;

    try {
      const budget = new CreditBudget({ perMinute: 0, perDay: 0 });
      const provider = new TwelveDataProvider("test-key", "DELAYED", undefined, budget);
      await assert.rejects(() => provider.fetchCandles(REQUEST), /credits exhausted/);
      assert.equal(requests, 0, "no HTTP request may be made once the budget is out");
    } finally {
      globalThis.fetch = original;
    }
  });

  await testAsync("a second read inside the TTL does not reach the provider", async () => {
    const provider = new CountingProvider();
    const service = new ClockedService([provider]);

    await service.getCandles(REQUEST);
    await service.getCandles(REQUEST);
    assert.equal(provider.calls, 1, "the cache must absorb the repeat");

    // Past the TTL it refetches: the cache is a budget, not a freeze.
    service.clock += candleTtlSeconds("5m") + 1;
    await service.getCandles(REQUEST);
    assert.equal(provider.calls, 2);
  });

  await testAsync("a failing feed serves the last real candles, not demo ones", async () => {
    const provider = new CountingProvider();
    const service = new ClockedService([provider]);

    const fresh = await service.getCandles(REQUEST);
    assert.equal(fresh.status.quality, "LIVE");
    assert.equal(fresh.candles[0]?.close, 100);

    service.clock += candleTtlSeconds("5m") + 60;
    provider.fail = true;

    const stale = await service.getCandles(REQUEST);
    assert.equal(stale.candles[0]?.close, 100, "the real price must survive the outage");
    assert.notEqual(stale.status.provider, "mock");
    // Real but no longer current, so it must not still claim to be live.
    assert.equal(stale.status.quality, "DELAYED");
    assert.match(stale.status.note ?? "", /feed down/);
    assert.match(stale.status.note ?? "", /\d+s old/);
  });

  await testAsync("with nothing cached a failure still falls back to demo", async () => {
    const provider = new CountingProvider();
    provider.fail = true;
    const service = new ClockedService([provider]);

    const result = await service.getCandles(REQUEST);
    assert.ok(result.candles.length > 0, "a chart is still drawn");
    assert.equal(result.status.quality, "DEMO");
    assert.match(result.status.note ?? "", /DEMO/);
  });

  await testAsync("a demo fallback is never written to the cache", async () => {
    // Otherwise one failed request pins synthetic prices in place for the whole
    // TTL, and the recovery is invisible until it expires.
    const provider = new CountingProvider();
    provider.fail = true;
    const service = new ClockedService([provider]);

    await service.getCandles(REQUEST);
    provider.fail = false;

    const recovered = await service.getCandles(REQUEST);
    assert.equal(recovered.status.quality, "LIVE", "recovery must be immediate");
    assert.equal(provider.calls, 2);
  });

  await testAsync("a DEMO success does not become the stale-real fallback", async () => {
    // Distinct from the test above, which covers the demo generator reached
    // *after* a failure. This is the demo provider being the chosen one and
    // succeeding — the live case for gold before a key is configured, since
    // `providerFor` falls through to the mock when nothing supports a symbol.
    // Cached, that entry would be served on the next outage under a note
    // promising "the last real candles", which is the single sentence the whole
    // fallback ladder exists in order to be able to say truthfully.
    let fail = false;
    const marker = 999;
    const provider: MarketDataProvider = {
      name: "mock",
      quality: "DEMO",
      metered: false,
      maxBarsPerCall: 1000,
      supports: () => true,
      fetchCandles: async () => {
        if (fail) throw new Error("feed down");
        return {
          candles: candles(marker),
          status: buildStatus({ quality: "DEMO", provider: "mock", candles: candles(marker) }),
        };
      },
    };
    const service = new ClockedService([provider]);

    const first = await service.getCandles(REQUEST);
    assert.equal(first.status.quality, "DEMO");
    assert.equal(first.candles[0]?.close, marker);

    service.clock += candleTtlSeconds("5m") + 60;
    fail = true;

    const after = await service.getCandles(REQUEST);
    assert.equal(after.status.quality, "DEMO", "synthetic candles must stay labelled DEMO");
    assert.doesNotMatch(
      after.status.note ?? "",
      /real candles/,
      "synthetic prices must never be described as real ones",
    );
    assert.notEqual(after.candles[0]?.close, marker, "the marker price would prove DEMO was cached");
  });

  await testAsync("the quoted price drops to zero once the cache can answer", async () => {
    // The number shown next to the refresh button. A flat per-symbol price
    // would be wrong most of the time, because inside the TTL the scan reaches
    // no provider at all — and quoting four credits for a free press teaches
    // the trader to ignore the number.
    const provider = new CountingProvider();
    provider.metered = true;
    const service = new ClockedService([provider]);
    const plan = [{ symbol: "XAUUSD", timeframes: [...MTF_CHAIN] }];

    const cold = service.estimateCost(plan, 100);
    assert.equal(cold.total, 4, "a cold chain costs one credit per bar");
    assert.equal(cold.perSymbol[0]?.cached, 0);

    for (const timeframe of MTF_CHAIN) {
      await service.getCandles({ symbol: "XAUUSD", timeframe, limit: 100 });
    }

    const warm = service.estimateCost(plan, 100);
    assert.equal(warm.total, 0, "a scan the cache can answer costs nothing");
    assert.equal(warm.perSymbol[0]?.cached, 4);
    // ...but it is not free forever, and saying so is the honest version.
    assert.equal(warm.fullTotal, 4, "the cold-cache price must still be reported");

    // The 5M entry expires first, so the price comes back one bar at a time
    // rather than all at once — which is why the estimate is per series.
    service.clock += candleTtlSeconds("5m") + 1;
    assert.equal(service.estimateCost(plan, 100).total, 1, "only the lapsed bar is chargeable");
  });

  await testAsync("a keyless feed is quoted at nothing however many bars it loads", async () => {
    // Yahoo and Binance cover everything in the watchlist except gold. If the
    // estimate counted requests rather than credits it would tell the user that
    // refreshing bitcoin costs four, and the obvious saving — untick gold —
    // would look like no saving at all.
    const free = new CountingProvider();
    const service = new ClockedService([free]);

    const cost = service.estimateCost([{ symbol: "BTCUSDT", timeframes: [...MTF_CHAIN] }], 100);
    assert.equal(cost.perSymbol[0]?.requests, 4, "the bars are still loaded");
    assert.equal(cost.total, 0, "they are just not charged for");
    assert.equal(cost.fullTotal, 0, "nor will they be when the cache lapses");
  });

  await testAsync("a series two parts of the plan both want is priced once", async () => {
    // The dollar basket asks for EURUSD/GBPUSD/USDJPY at 4H, and those three
    // are in the watchlist already. Pricing the overlap twice would invent a
    // credit that is never spent, in the one number the user checks before
    // deciding whether they can afford to press.
    const provider = new CountingProvider();
    provider.metered = true;
    const service = new ClockedService([provider]);

    const cost = service.estimateCost(
      [
        { symbol: "EURUSD", timeframes: [...MTF_CHAIN] },
        { symbol: "EURUSD", timeframes: ["4h"] },
      ],
      100,
    );
    assert.equal(cost.perSymbol.length, 1, "one symbol, one row");
    assert.equal(cost.total, MTF_CHAIN.length, "the shared 4H bar is not charged twice");
  });

  await testAsync("a windowed request does not return the live series from cache", async () => {
    // The news study asks for a window around an old release. Keyed only by
    // symbol and timeframe, it would collide with the chart's own series.
    const provider = new CountingProvider();
    const service = new ClockedService([provider]);

    await service.getCandles(REQUEST);
    await service.getCandles({ ...REQUEST, startTime: 1_600_000_000, endTime: 1_600_086_400 });
    assert.equal(provider.calls, 2, "a different window is a different series");
  });
}

run().then(
  () => {
    process.stdout.write(`quota.test.ts: ${passed} market-data quota and cache guards passed\n`);
  },
  (error: unknown) => {
    process.stderr.write(
      `quota.test.ts failed: ${error instanceof Error ? error.stack : String(error)}\n`,
    );
    process.exitCode = 1;
  },
);
