import assert from "node:assert/strict";
import { ASSETS, getAsset, requireAsset } from "./assets";
import { MockMarketDataProvider, generateCandles } from "./mock";
import { BinanceMarketDataProvider } from "./binance";
import { TwelveDataProvider } from "./twelvedata";
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
});

test("provider priority puts live feeds first and demo last", () => {
  const withKey = createProviders({ twelveDataApiKey: "test-key" });
  assert.deepEqual(
    withKey.map((p) => p.name),
    ["binance", "twelvedata", "mock"],
  );

  const noKey = createProviders({});
  assert.deepEqual(
    noKey.map((p) => p.name),
    ["binance", "mock"],
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
  assert.equal(service.providerFor("XAUUSD").name, "twelvedata");
  assert.equal(service.providerFor("SOMETHING").name, "mock", "unknown symbols fall back to demo");
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
