import assert from "node:assert/strict";
import { ASSETS, getAsset, requireAsset } from "./assets";
import { MockMarketDataProvider, generateCandles } from "./mock";
import { BinanceMarketDataProvider } from "./binance";
import { TwelveDataProvider } from "./twelvedata";
import { YahooFinanceProvider, normaliseYahooRows } from "./yahoo";
import { MarketDataService, createProviders } from "./service";
import { TIMEFRAME_SECONDS } from "./types";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  process.stdout.write(`  ok ${name}\n`);
}

async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed++;
  process.stdout.write(`  ok ${name}\n`);
}

test("the asset catalogue covers the required markets", () => {
  for (const symbol of ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSDT", "ETHUSDT"]) {
    const asset = getAsset(symbol);
    assert.ok(asset, `${symbol} must be in the catalogue`);
    assert.ok(asset.minTick > 0);
    assert.ok(asset.pipSize > 0);
  }
  assert.equal(getAsset("NOPE"), null);
  assert.throws(() => requireAsset("NOPE"));
});

test("crypto has no pip value per lot and forex does", () => {
  assert.equal(requireAsset("BTCUSDT").pipValuePerLot, null);
  assert.ok((requireAsset("EURUSD").pipValuePerLot ?? 0) > 0);
  assert.ok(ASSETS.every((a) => a.quote.length >= 3));
});

test("generated candles are ordered, aligned and internally consistent", () => {
  const candles = generateCandles({ symbol: "XAUUSD", timeframe: "15m", limit: 200 });
  assert.equal(candles.length, 200);
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    assert.ok(c, "candle must exist");
    assert.ok(c.high >= Math.max(c.open, c.close), "high must cover the body");
    assert.ok(c.low <= Math.min(c.open, c.close), "low must cover the body");
    assert.ok(c.volume > 0);
    if (i > 0) {
      const prev = candles[i - 1];
      assert.ok(prev);
      assert.equal(c.time - prev.time, TIMEFRAME_SECONDS["15m"], "candles must be evenly spaced");
    }
  }
});

test("the generator is deterministic for the same symbol and timeframe", () => {
  const a = generateCandles({ symbol: "EURUSD", timeframe: "1h", limit: 100 });
  const b = generateCandles({ symbol: "EURUSD", timeframe: "1h", limit: 100 });
  assert.deepEqual(
    a.map((c) => c.close),
    b.map((c) => c.close),
    "the same seed must produce the same series",
  );

  const c = generateCandles({ symbol: "GBPUSD", timeframe: "1h", limit: 100 });
  assert.notDeepEqual(
    a.map((x) => x.close),
    c.map((x) => x.close),
    "different symbols must produce different series",
  );
});

test("generated prices stay in a plausible band for the instrument", () => {
  const gold = generateCandles({ symbol: "XAUUSD", timeframe: "15m", limit: 300 });
  for (const c of gold) {
    assert.ok(c.close > 1000 && c.close < 6000, `gold price out of band: ${c.close}`);
  }
  const eur = generateCandles({ symbol: "EURUSD", timeframe: "15m", limit: 300 });
  for (const c of eur) {
    assert.ok(c.close > 0.5 && c.close < 2, `EURUSD out of band: ${c.close}`);
  }
});

test("a custom seed reproduces a replay session exactly", () => {
  const a = generateCandles({ symbol: "BTCUSDT", timeframe: "5m", limit: 50 }, { seed: 42 });
  const b = generateCandles({ symbol: "BTCUSDT", timeframe: "5m", limit: 50 }, { seed: 42 });
  assert.deepEqual(a, b);
});

test("provider support is declared honestly", () => {
  const binance = new BinanceMarketDataProvider();
  assert.equal(binance.supports("BTCUSDT"), true);
  assert.equal(binance.supports("XAUUSD"), false);
  assert.equal(binance.quality, "LIVE");

  const keyless = new TwelveDataProvider("");
  assert.equal(keyless.supports("XAUUSD"), false, "no key means no support");

  const keyed = new TwelveDataProvider("test-key");
  assert.equal(keyed.supports("XAUUSD"), true);
  assert.equal(keyed.supports("BTCUSDT"), false);
  assert.equal(keyed.quality, "DELAYED");

  const yahoo = new YahooFinanceProvider();
  assert.equal(yahoo.supports("EURUSD"), true);
  assert.equal(yahoo.supports("USDJPY"), true);
  assert.equal(yahoo.supports("XAUUSD"), false, "Yahoo has no gold spot symbol");
  assert.equal(yahoo.supports("BTCUSDT"), false);
  assert.equal(yahoo.quality, "LIVE");
});

test("provider priority puts live feeds first and demo last", () => {
  const withKey = createProviders({ twelveDataApiKey: "test-key" });
  assert.deepEqual(
    withKey.map((p) => p.name),
    ["binance", "yahoo", "twelvedata", "mock"],
    "the realtime keyless feed must outrank the delayed keyed one",
  );

  const noKey = createProviders({});
  assert.deepEqual(
    noKey.map((p) => p.name),
    ["binance", "yahoo", "mock"],
  );

  const forced = createProviders({ forceDemo: true });
  assert.deepEqual(
    forced.map((p) => p.name),
    ["mock"],
  );
});

test("the service routes each symbol to the right provider", () => {
  const service = MarketDataService.fromConfig({ twelveDataApiKey: "test-key" });
  assert.equal(service.providerFor("BTCUSDT").name, "binance");
  assert.equal(service.providerFor("EURUSD").name, "yahoo");
  assert.equal(service.providerFor("XAUUSD").name, "twelvedata", "gold needs a metals feed");
  assert.equal(service.providerFor("SOMETHING").name, "mock", "unknown symbols fall back to demo");

  const keyless = MarketDataService.fromConfig({});
  assert.equal(keyless.providerFor("GBPUSD").name, "yahoo", "FX must not need a key");
  assert.equal(keyless.providerFor("XAUUSD").name, "mock");
});

test("the Yahoo live quote is folded into the bar it belongs to", () => {
  // 17:00 is the open bar; 17:13:49 is the quote Yahoo appends stamped with
  // "now". One 1h candle must come out of the pair, stamped 17:00.
  const hour = 1_760_000_000 - (1_760_000_000 % 3600);
  const rows = [
    { time: hour - 3600, open: 1.1, high: 1.11, low: 1.09, close: 1.105, volume: 0 },
    { time: hour, open: 1.105, high: 1.106, low: 1.104, close: 1.1055, volume: 0 },
    { time: hour + 829, open: 1.108, high: 1.112, low: 1.1, close: 1.111, volume: 0 },
  ];
  const out = normaliseYahooRows(rows, 3600, 400);
  assert.equal(out.length, 2, "the unaligned live row must not become its own candle");
  const last = out[1];
  assert.ok(last);
  assert.equal(last.time, hour, "the candle keeps the bar's open time");
  assert.equal(last.open, 1.105, "open comes from the bar");
  assert.equal(last.close, 1.111, "close comes from the live quote");
  assert.equal(last.high, 1.112, "the live quote can extend the high");
  assert.equal(last.low, 1.1, "the live quote can extend the low");
});

test("a live quote with no completed bar yet still lands on the bucket", () => {
  // Seen on USDJPY 5m: the bucket's own bar had not been published, so the
  // quote was the only row for it. Snapping is what keeps the spacing even.
  const bucket = 1_760_000_000 - (1_760_000_000 % 300);
  const rows = [
    { time: bucket - 300, open: 158.4, high: 158.5, low: 158.3, close: 158.45, volume: 0 },
    { time: bucket + 2, open: 158.45, high: 158.52, low: 158.44, close: 158.51, volume: 0 },
  ];
  const out = normaliseYahooRows(rows, 300, 400);
  assert.equal(out.length, 2);
  const first = out[0];
  const second = out[1];
  assert.ok(first && second);
  assert.equal(second.time - first.time, 300, "candles must stay evenly spaced");
  assert.equal(second.close, 158.51);
});

test("Yahoo 1h bars aggregate into UTC-aligned 4h bars", () => {
  const start = 1_760_000_000 - (1_760_000_000 % 14400);
  const rows = Array.from({ length: 8 }, (_, i) => ({
    time: start + i * 3600,
    open: 100 + i,
    high: 100 + i + 2,
    low: 100 + i - 2,
    close: 100 + i + 1,
    volume: 10,
  }));

  const out = normaliseYahooRows(rows, 14400, 400);
  assert.equal(out.length, 2, "eight 1h bars make two 4h bars");
  const first = out[0];
  assert.ok(first);
  assert.equal(first.time % 14400, 0, "4h buckets must align to the UTC epoch");
  assert.equal(first.open, 100, "open comes from the first hour");
  assert.equal(first.close, 104, "close comes from the last hour");
  assert.equal(first.high, 105, "high is the max across the bucket");
  assert.equal(first.low, 98, "low is the min across the bucket");
  assert.equal(first.volume, 40, "volume sums across the bucket");

  const trimmed = normaliseYahooRows(rows, 14400, 1);
  assert.equal(trimmed.length, 1, "the series is trimmed to the requested limit");
  assert.equal(trimmed[0]?.time, start + 14400, "trimming keeps the newest candles");
});

test("Yahoo daily bars keep the exchange's own date", () => {
  // FX dailies are stamped at London midnight (23:00 UTC in summer). Snapping
  // those to a UTC day would move every bar back a day.
  const londonMidnight = 1_760_000_000 - (1_760_000_000 % 86400) + 82800;
  const rows = [
    { time: londonMidnight - 86400, open: 1.12, high: 1.13, low: 1.11, close: 1.125, volume: 0 },
    { time: londonMidnight, open: 1.125, high: 1.128, low: 1.12, close: 1.121, volume: 0 },
  ];
  const out = normaliseYahooRows(rows, 86400, 400);
  assert.deepEqual(
    out.map((c) => c.time),
    rows.map((c) => c.time),
    "daily timestamps must pass through untouched",
  );
});

async function run(): Promise<void> {
  await testAsync("the mock provider always labels its data DEMO", async () => {
  const provider = new MockMarketDataProvider();
  const result = await provider.fetchCandles({ symbol: "XAUUSD", timeframe: "15m", limit: 120 });
  assert.equal(result.status.quality, "DEMO");
  assert.equal(result.status.provider, "mock");
  assert.equal(result.status.candleCount, 120);
  assert.ok(result.status.note?.includes("do not trade"), "demo data must warn the user");
  assert.equal(result.status.lastCandleTime, result.candles[result.candles.length - 1]?.time);
  });

  await testAsync("a failing live feed degrades to DEMO and says why", async () => {
  const broken = {
    name: "broken",
    quality: "LIVE" as const,
    metered: false,
    maxBarsPerCall: 1000,
    supports: () => true,
    fetchCandles: async () => {
      throw new Error("network down");
    },
  };
  const service = new MarketDataService([broken, new MockMarketDataProvider()]);
  const result = await service.getCandles({ symbol: "BTCUSDT", timeframe: "15m", limit: 100 });
  assert.equal(result.status.quality, "DEMO", "a failed live fetch must never be labelled LIVE");
  assert.ok(result.status.note?.includes("network down"));
  assert.equal(result.candles.length, 100);
  });

  await testAsync("the MTF loader reports the weakest quality in the chain", async () => {
  const live = {
    name: "live-4h",
    quality: "LIVE" as const,
    metered: false,
    maxBarsPerCall: 1000,
    supports: () => true,
    fetchCandles: async () => {
      const candles = generateCandles({ symbol: "BTCUSDT", timeframe: "4h", limit: 60 });
      return {
        candles,
        status: {
          quality: "LIVE" as const,
          provider: "live-4h",
          lastCandleTime: candles[candles.length - 1]?.time ?? 0,
          candleCount: candles.length,
        },
      };
    },
  };
  const mixed = new MarketDataService([live]);
  const liveOnly = await mixed.getMtf("BTCUSDT", ["4h", "1h"], 60);
  assert.equal(liveOnly.status.quality, "LIVE");
  assert.equal(Object.keys(liveOnly.candles).length, 2);

  const demoService = MarketDataService.fromConfig({ forceDemo: true });
  const demoChain = await demoService.getMtf("XAUUSD", ["4h", "1h", "15m", "5m"], 120);
  assert.equal(demoChain.status.quality, "DEMO");
  assert.equal(demoChain.candles["15m"]?.length, 120);
  });
}

run().then(
  () => {
    process.stdout.write(`\nmock.test.ts: ${passed} passed\n`);
  },
  (error: unknown) => {
    process.stderr.write(`\nmock.test.ts failed: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  },
);
