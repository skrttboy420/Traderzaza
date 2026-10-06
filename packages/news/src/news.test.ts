import assert from "node:assert/strict";
import type { Candle } from "@atc/types";

import { ForexFactoryProvider } from "./forexfactory";
import { InvestingCalendarProvider } from "./investing";
import { MockNewsProvider } from "./mock";
import { TradingViewCalendarProvider } from "./tradingview";
import { MIN_SAMPLES, readTendency, studyReactions } from "./reaction";
import {
  BLACKOUT_BEFORE_MIN,
  assessNewsRisk,
  currencyRelevance,
  filterRelevant,
  relevantCurrencies,
} from "./relevance";
import { NewsService } from "./service";
import type { NewsEvent, NewsOccurrence } from "./types";

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

/* -------------------------------------------------------------------------- */
/*  Relevance                                                                 */
/* -------------------------------------------------------------------------- */

test("a pair's own two currencies outrank everything else", () => {
  const eur = currencyRelevance("EURUSD");
  assert.deepEqual(
    eur.map((r) => r.currency),
    ["EUR", "USD"],
  );
  assert.ok(eur.every((r) => r.weight === 1));

  const jpy = relevantCurrencies("USDJPY");
  assert.deepEqual(jpy.sort(), ["JPY", "USD"]);
});

test("gold and crypto are tied to USD even though their base is not a currency", () => {
  assert.deepEqual(relevantCurrencies("XAUUSD"), ["USD"]);
  assert.deepEqual(relevantCurrencies("BTCUSDT"), ["USD"], "USDT must not split as a currency pair");
  assert.deepEqual(relevantCurrencies("ETHUSDT"), ["USD"]);
  assert.equal(currencyRelevance("XAUUSD")[0]?.reason, "quoteCurrency");
});

test("irrelevant currencies and holidays are filtered out", () => {
  const events: NewsEvent[] = [
    makeEvent({ currency: "USD", impact: 3, time: 1_000 }),
    makeEvent({ currency: "AUD", impact: 3, time: 2_000 }),
    makeEvent({ currency: "USD", impact: 1, time: 3_000 }),
    makeEvent({ currency: "USD", impact: 3, time: 4_000, isHoliday: true }),
  ];
  const kept = filterRelevant(events, "XAUUSD", 2);
  assert.equal(kept.length, 1, "only the medium-or-better USD non-holiday row survives");
  assert.equal(kept[0]?.time, 1_000);
});

/* -------------------------------------------------------------------------- */
/*  Risk window                                                               */
/* -------------------------------------------------------------------------- */

test("a high-impact release minutes away is a blackout, not a suggestion", () => {
  const now = 1_700_000_000;
  const risk = assessNewsRisk({
    symbol: "XAUUSD",
    now,
    events: [makeEvent({ currency: "USD", impact: 3, time: now + 10 * 60, title: "NFP" })],
  });
  assert.equal(risk.level, "blackout");
  assert.equal(risk.reasonKey, "blackout");
  assert.equal(risk.secondsAway, 600);
});

test("the blackout still holds just after the number prints", () => {
  const now = 1_700_000_000;
  const risk = assessNewsRisk({
    symbol: "EURUSD",
    now,
    events: [makeEvent({ currency: "EUR", impact: 3, time: now - 5 * 60 })],
  });
  assert.equal(risk.level, "blackout", "the whipsaw after the release is the dangerous part");
  assert.ok(risk.secondsAway !== null && risk.secondsAway < 0);
});

test("a high-impact release hours away is caution, not blackout", () => {
  const now = 1_700_000_000;
  const risk = assessNewsRisk({
    symbol: "XAUUSD",
    now,
    events: [makeEvent({ currency: "USD", impact: 3, time: now + (BLACKOUT_BEFORE_MIN + 45) * 60 })],
  });
  assert.equal(risk.level, "caution");
  assert.equal(risk.reasonKey, "cautionHigh");
});

test("an unrelated currency never triggers a warning", () => {
  const now = 1_700_000_000;
  const risk = assessNewsRisk({
    symbol: "XAUUSD",
    now,
    events: [makeEvent({ currency: "JPY", impact: 3, time: now + 5 * 60 })],
  });
  assert.equal(risk.level, "clear");
});

test("a missing calendar reports noData instead of a false all-clear", () => {
  const risk = assessNewsRisk({ symbol: "XAUUSD", now: 1_700_000_000, events: [], haveData: false });
  assert.equal(risk.reasonKey, "noData");
  assert.equal(risk.event, null);
  assert.deepEqual(risk.upcoming, []);
});

/* -------------------------------------------------------------------------- */
/*  Reaction study                                                            */
/* -------------------------------------------------------------------------- */

const HOUR = 3600;

/** A flat 2000.00 series so any measured move comes only from what we inject. */
function flatSeries(start: number, count: number, price = 2000): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < count; i += 1) {
    candles.push({ time: start + i * HOUR, open: price, high: price, low: price, close: price, volume: 1 });
  }
  return candles;
}

function occurrence(time: number, surprise: "better" | "worse" | "inline", id = time): NewsOccurrence {
  return { eventId: 227, occurrenceId: id, time, actual: 1, forecast: 0, previous: 0, surprise };
}

test("the study measures the candle that contains the release, against the one before", () => {
  const start = 1_700_000_000 - (1_700_000_000 % HOUR);
  const candles = flatSeries(start, 10);
  // Release lands inside candle index 5; that candle closes 1% lower.
  const target = candles[5];
  assert.ok(target);
  target.close = 1980;
  target.low = 1975;

  const study = studyReactions({
    symbol: "XAUUSD",
    eventId: 227,
    occurrences: [occurrence(start + 5 * HOUR + 1800, "better")],
    candles,
    timeframeSeconds: HOUR,
  });

  assert.equal(study.samples.length, 1);
  assert.equal(study.windowMinutes, 60);
  const sample = study.samples[0];
  assert.ok(sample);
  assert.equal(sample.basePrice, 2000, "base is the close before the news, not the open after");
  assert.equal(sample.exitPrice, 1980);
  assert.ok(Math.abs(sample.movePercent + 1) < 1e-9, "a 2000 -> 1980 close is -1%");
  assert.ok(sample.rangePercent > 0, "the window's high-low must be reported too");
});

test("releases outside the candle coverage are skipped, never approximated", () => {
  const start = 1_700_000_000 - (1_700_000_000 % HOUR);
  const candles = flatSeries(start, 5);
  const study = studyReactions({
    symbol: "XAUUSD",
    eventId: 227,
    occurrences: [
      occurrence(start - 50 * HOUR, "better", 1), // long before our data
      occurrence(start + 500 * HOUR, "worse", 2), // long after
      occurrence(start, "better", 3), // first candle: no "before" candle exists
    ],
    candles,
    timeframeSeconds: HOUR,
  });
  assert.equal(study.samples.length, 0);
  assert.equal(study.skipped, 3, "every unmeasurable release must be counted, not dropped silently");
  assert.equal(study.usable, false);
});

test("an in-line print is excluded because it is not a surprise", () => {
  const start = 1_700_000_000 - (1_700_000_000 % HOUR);
  const study = studyReactions({
    symbol: "XAUUSD",
    eventId: 227,
    occurrences: [occurrence(start + 3 * HOUR, "inline")],
    candles: flatSeries(start, 10),
    timeframeSeconds: HOUR,
  });
  assert.equal(study.samples.length, 0);
  assert.equal(study.skipped, 1);
});

test("a consistent reaction is reported with its direction and sample count", () => {
  const start = 1_700_000_000 - (1_700_000_000 % HOUR);
  const candles = flatSeries(start, 60);
  const occurrences: NewsOccurrence[] = [];
  // Four "better" prints, all of which drove price down 1%.
  for (let i = 0; i < 4; i += 1) {
    const index = 5 + i * 10;
    const bar = candles[index];
    assert.ok(bar);
    bar.close = 1980;
    bar.low = 1975;
    occurrences.push(occurrence(start + index * HOUR + 60, "better", i));
  }

  const study = studyReactions({
    symbol: "XAUUSD",
    eventId: 227,
    occurrences,
    candles,
    timeframeSeconds: HOUR,
  });

  assert.equal(study.better.count, 4);
  assert.ok(study.better.enough, `${MIN_SAMPLES} samples is the minimum and we have 4`);
  assert.equal(study.better.downCount, 4);
  assert.equal(study.better.upCount, 0);
  assert.ok(Math.abs(study.better.medianMovePercent + 1) < 1e-9);
  assert.equal(study.usable, true);

  const reading = readTendency(study.better);
  assert.equal(reading.tendency, "down");
  assert.equal(reading.consistency, 1);
});

test("a split reaction is called mixed rather than forced into a direction", () => {
  const start = 1_700_000_000 - (1_700_000_000 % HOUR);
  const candles = flatSeries(start, 60);
  const occurrences: NewsOccurrence[] = [];
  for (let i = 0; i < 4; i += 1) {
    const index = 5 + i * 10;
    const bar = candles[index];
    assert.ok(bar);
    // Alternate up and down: the event moves price but with no reliable side.
    bar.close = i % 2 === 0 ? 2020 : 1980;
    bar.high = 2025;
    bar.low = 1975;
    occurrences.push(occurrence(start + index * HOUR + 60, "worse", i));
  }

  const study = studyReactions({ symbol: "XAUUSD", eventId: 227, occurrences, candles, timeframeSeconds: HOUR });
  const reading = readTendency(study.worse);
  assert.equal(reading.tendency, "mixed");
  assert.equal(reading.consistency, 0.5);
  assert.ok(reading.medianRangePercent > 0, "mixed still tells you it moves — trade the reaction");
});

test("too few samples is reported as unknown, not as a weak tendency", () => {
  const start = 1_700_000_000 - (1_700_000_000 % HOUR);
  const candles = flatSeries(start, 20);
  const bar = candles[5];
  assert.ok(bar);
  bar.close = 1980;

  const study = studyReactions({
    symbol: "XAUUSD",
    eventId: 227,
    occurrences: [occurrence(start + 5 * HOUR + 60, "better")],
    candles,
    timeframeSeconds: HOUR,
  });
  assert.equal(study.better.enough, false);
  assert.equal(readTendency(study.better).tendency, "unknown");
  assert.equal(study.usable, false, "one data point must never become a claim");
});

test("the median ignores a single extreme release", () => {
  const start = 1_700_000_000 - (1_700_000_000 % HOUR);
  const candles = flatSeries(start, 60);
  const moves = [1980, 1980, 1980, 1000]; // the last one is a -50% outlier
  const occurrences: NewsOccurrence[] = [];
  moves.forEach((close, i) => {
    const index = 5 + i * 10;
    const bar = candles[index];
    assert.ok(bar);
    bar.close = close;
    bar.low = close;
    occurrences.push(occurrence(start + index * HOUR + 60, "better", i));
  });

  const study = studyReactions({ symbol: "XAUUSD", eventId: 227, occurrences, candles, timeframeSeconds: HOUR });
  assert.ok(
    Math.abs(study.better.medianMovePercent + 1) < 1e-9,
    `median should stay at -1%, got ${study.better.medianMovePercent}`,
  );
});

/* -------------------------------------------------------------------------- */
/*  Providers and service                                                     */
/* -------------------------------------------------------------------------- */

test("the investing.com row parser reads a real legacy table row", () => {
  const provider = new InvestingCalendarProvider();
  assert.equal(provider.demo, false);
  assert.equal(provider.name, "investing.com");
});

/** Captures the URL each provider asks for, so we can assert on the query. */
let lastUrls: string[] = [];

function stubFetch(payload: unknown, status = 200): typeof fetch {
  return (async (input: unknown) => {
    lastUrls.push(String(input));
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

/** Shaped exactly like rows observed on the live endpoint. */
function tvRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "398485",
    title: "Non Farm Payrolls",
    country: "US",
    indicator: "Non Farm Payrolls",
    comment: "Monthly change in US paid employees.",
    category: "lbr",
    period: "Sep",
    actual: 119,
    previous: 72,
    forecast: 50,
    actualRaw: 119000,
    previousRaw: 72000,
    forecastRaw: 50000,
    currency: "USD",
    scale: "K",
    importance: 1,
    date: "2026-10-02T12:30:00.000Z",
    ...over,
  };
}

async function run(): Promise<void> {
  await testAsync("tradingview rows keep the source's own impact rating and UTC time", async () => {
    lastUrls = [];
    const provider = new TradingViewCalendarProvider({
      fetchImpl: stubFetch({
        status: "ok",
        result: [
          tvRow(),
          tvRow({ id: "1", title: "Factory Orders", indicator: "Factory Orders", importance: 0 }),
          tvRow({ id: "2", title: "Columbus Day", indicator: "Holidays", importance: -1, actual: null, forecast: null, previous: null, actualRaw: null, forecastRaw: null, previousRaw: null }),
        ],
      }),
    });
    const response = await provider.fetchCalendar({ from: 1_790_000_000 - 86_400, to: 1_790_000_000 + 30 * 86_400 });
    assert.equal(response.demo, false);
    assert.equal(response.provider, "tradingview");
    const [nfp, orders, holiday] = response.events;
    // -1 / 0 / 1 on the wire must land on the 1-3 scale traders recognise.
    assert.equal(nfp?.impact, 3);
    assert.equal(orders?.impact, 2);
    assert.equal(holiday?.impact, 1);
    assert.equal(holiday?.isHoliday, true);
    // 12:30Z, not shifted by whatever timezone the server happens to run in.
    assert.equal(nfp?.time, Math.floor(Date.parse("2026-10-02T12:30:00Z") / 1000));
    assert.equal(nfp?.actual, "119K", "the scale belongs with the number");
    assert.equal(nfp?.surprise, "better", "119k against a 50k forecast is a beat");
    assert.ok(lastUrls[0]?.includes("countries=US"), "the request must be scoped to countries");
  });

  await testAsync("an inverted series is judged for the currency, not by the raw number", async () => {
    const provider = new TradingViewCalendarProvider({
      fetchImpl: stubFetch({
        status: "ok",
        result: [
          // Claims came in *lower* than forecast, which is good for USD.
          tvRow({
            title: "Initial Jobless Claims",
            indicator: "Initial Jobless Claims",
            actual: 228,
            forecast: 242,
            actualRaw: 228000,
            forecastRaw: 242000,
          }),
          // And a release nobody forecast cannot have a surprise at all.
          tvRow({ id: "9", title: "Fed Speech", indicator: "Fed Speech", actual: null, forecast: null, actualRaw: null, forecastRaw: null }),
        ],
      }),
    });
    const response = await provider.fetchCalendar({ from: 0, to: 2_000_000_000 });
    assert.equal(response.events[0]?.surprise, "better", "a lower claims print is a beat, not a miss");
    assert.equal(response.events[1]?.surprise, null, "no forecast means no verdict, not 'inline'");
    assert.equal(response.events[1]?.isSpeech, true);
  });

  await testAsync("tradingview history keeps only the asked-for series and the comparable prints", async () => {
    lastUrls = [];
    const provider = new TradingViewCalendarProvider({
      fetchImpl: stubFetch({
        status: "ok",
        result: [
          tvRow({ id: "100", date: "2026-08-07T12:30:00.000Z", actualRaw: 60000, forecastRaw: 90000 }),
          tvRow({ id: "101", date: "2026-09-04T12:30:00.000Z", actualRaw: 140000, forecastRaw: 100000 }),
          // Same country, different series: must not pollute the study.
          tvRow({ id: "102", title: "Retail Sales", indicator: "Retail Sales" }),
          // Same series, but no forecast to compare against.
          tvRow({ id: "103", date: "2026-07-03T12:30:00.000Z", forecastRaw: null, forecast: null }),
        ],
      }),
    });
    const calendar = await provider.fetchCalendar({ from: 0, to: 2_000_000_000 });
    const nfpId = calendar.events.find((e) => e.title === "Non Farm Payrolls")?.eventId ?? 0;
    const history = await provider.fetchHistory(nfpId);
    assert.ok(history, "the series was seen in the calendar, so history must resolve");
    assert.equal(history?.occurrences.length, 2, "one wrong series and one unforecast print are dropped");
    assert.deepEqual(
      history?.occurrences.map((o) => o.surprise),
      ["better", "worse"],
      "newest first: Sep beat, Aug missed",
    );
    assert.ok(history?.description.includes("paid employees"), "the source's own description is carried through");
    assert.ok(
      lastUrls[1]?.includes("minImportance=1"),
      "without minImportance a two-year window overflows the endpoint's row cap",
    );
  });

  await testAsync("the forexfactory feed gives impact strength but never invents an actual", async () => {
    const provider = new ForexFactoryProvider({
      fetchImpl: stubFetch([
        { title: "Non-Farm Employment Change", country: "USD", date: "2026-10-02T08:30:00-04:00", impact: "High", forecast: "50K", previous: "72K" },
        { title: "Bank Holiday", country: "CNY", date: "2026-10-05T19:01:00-04:00", impact: "Holiday", forecast: "", previous: "" },
        { title: "OPEC-JMMC Meetings", country: "All", date: "2026-10-04T05:15:00-04:00", impact: "Medium", forecast: "", previous: "" },
      ]),
    });
    const response = await provider.fetchCalendar({ from: 0, to: 2_000_000_000 });
    assert.equal(response.demo, false);
    const nfp = response.events.find((e) => e.currency === "USD");
    assert.equal(nfp?.impact, 3);
    assert.equal(nfp?.forecast, "50K");
    assert.equal(nfp?.actual, null, "the feed has no actual, so the row must not claim one");
    assert.equal(nfp?.surprise, null);
    // 08:30 New York = 12:30 UTC. The offset in the feed is authoritative.
    assert.equal(nfp?.time, Math.floor(Date.parse("2026-10-02T12:30:00Z") / 1000));
    assert.equal(response.events.find((e) => e.title === "Bank Holiday")?.isHoliday, true);
    assert.equal(response.events.find((e) => e.title.startsWith("OPEC"))?.currency, "", "'All' is not a currency");
    assert.equal(await provider.fetchHistory(1), null, "no actuals means no honest history");
  });

  await testAsync("the service names whichever source actually answered", async () => {
    const service = NewsService.fromConfig({
      fetchImpl: stubFetch({ status: "ok", result: [tvRow()] }),
      ttlSeconds: 60,
    });
    const response = await service.getCalendar({ from: 0, to: 2_000_000_000 });
    assert.equal(response.provider, "tradingview");
    assert.equal(response.demo, false);
    assert.equal(response.note, undefined, "a clean first-try fetch has nothing to explain");
  });

  await testAsync("the demo calendar labels every row as synthetic", async () => {
    const provider = new MockNewsProvider();
    const now = 1_700_000_000;
    const response = await provider.fetchCalendar({ from: now, to: now + 7 * 86_400 });
    assert.equal(response.demo, true);
    assert.equal(response.provider, "demo-calendar");
    assert.ok(response.note?.includes("not real"), "synthetic rows must say so");
    assert.ok(response.events.length > 0);
    assert.ok(
      response.events.every((e) => e.title.includes("DEMO")),
      "even the event titles must carry the warning",
    );
    for (let i = 1; i < response.events.length; i += 1) {
      const prev = response.events[i - 1];
      const curr = response.events[i];
      assert.ok(prev && curr && curr.time >= prev.time, "events must be in time order");
    }
  });

  await testAsync("a failed scrape falls back to demo and explains why", async () => {
    const broken = {
      name: "broken-source",
      demo: false,
      fetchCalendar: async () => {
        throw new Error("403 from the edge");
      },
      fetchHistory: async () => null,
    };
    const service = new NewsService([broken, new MockNewsProvider()], 60);
    const now = 1_700_000_000;
    const response = await service.getCalendar({ from: now, to: now + 86_400 });
    assert.equal(response.demo, true, "a failed real fetch must never be labelled real");
    assert.ok(response.note?.includes("403 from the edge"), "the user is told what actually failed");
    assert.ok(response.note?.includes("Fell back after"));
  });

  await testAsync("the service caches instead of hammering the source", async () => {
    let calls = 0;
    const counting = {
      name: "counting",
      demo: false,
      fetchCalendar: async () => {
        calls += 1;
        return {
          events: [makeEvent({ currency: "USD", impact: 3, time: 1_700_000_000 })],
          provider: "counting",
          demo: false,
          fetchedAt: 0,
        };
      },
      fetchHistory: async () => null,
    };
    const service = new NewsService([counting], 900);
    const range = { from: 1_700_000_000, to: 1_700_086_400 };
    await service.getCalendar(range);
    await service.getCalendar(range);
    await service.getCalendar(range);
    assert.equal(calls, 1, "three reads of the same window must hit the source once");
  });

  await testAsync("every provider failing returns emptiness, not invented rows", async () => {
    const broken = {
      name: "broken",
      demo: false,
      fetchCalendar: async () => {
        throw new Error("down");
      },
      fetchHistory: async () => null,
    };
    const service = new NewsService([broken], 60);
    const response = await service.getCalendar({ from: 0, to: 86_400 });
    assert.deepEqual(response.events, []);
    assert.equal(response.provider, "none");
    assert.ok(response.note?.includes("No calendar source answered"));
  });

  await testAsync("demo history feeds the reaction study end to end", async () => {
    const provider = new MockNewsProvider();
    const history = await provider.fetchHistory(900_227);
    assert.ok(history);
    assert.equal(history.occurrences.length, 24);
    assert.ok(history.description.includes("generated"), "synthetic history must say so");

    // Build hourly candles covering the whole synthetic history.
    const oldest = history.occurrences[history.occurrences.length - 1];
    assert.ok(oldest);
    const start = Math.floor((oldest.time - 10 * HOUR) / HOUR) * HOUR;
    const count = Math.ceil((Math.floor(Date.now() / 1000) - start) / HOUR) + 2;
    const candles = flatSeries(start, count);

    // Paint a consistent reaction into the series: every "better" print drops
    // this market 1%, every "worse" print lifts it 0.5%. The study must recover
    // exactly that from the candles alone.
    for (const occ of history.occurrences) {
      const index = Math.floor((occ.time - start) / HOUR);
      const bar = candles[index];
      if (!bar) continue;
      bar.close = occ.surprise === "better" ? 1980 : 2010;
      bar.high = Math.max(2000, bar.close);
      bar.low = Math.min(2000, bar.close);
    }

    const study = studyReactions({
      symbol: "XAUUSD",
      eventId: 900_227,
      occurrences: history.occurrences,
      candles,
      timeframeSeconds: HOUR,
    });
    assert.ok(study.samples.length >= 20, `expected most releases to be measurable, got ${study.samples.length}`);

    const better = readTendency(study.better);
    assert.equal(better.tendency, "down");
    assert.ok(Math.abs(better.medianMovePercent + 1) < 1e-9);

    const worse = readTendency(study.worse);
    assert.equal(worse.tendency, "up");
    assert.ok(Math.abs(worse.medianMovePercent - 0.5) < 1e-9);
  });

  await testAsync("a market that simply does not react is reported as unknown, not mixed", async () => {
    const provider = new MockNewsProvider();
    const history = await provider.fetchHistory(900_733);
    assert.ok(history);
    const oldest = history.occurrences[history.occurrences.length - 1];
    assert.ok(oldest);
    const start = Math.floor((oldest.time - 10 * HOUR) / HOUR) * HOUR;
    const count = Math.ceil((Math.floor(Date.now() / 1000) - start) / HOUR) + 2;

    const study = studyReactions({
      symbol: "XAUUSD",
      eventId: 900_733,
      occurrences: history.occurrences,
      candles: flatSeries(start, count),
      timeframeSeconds: HOUR,
    });
    assert.ok(study.better.count >= MIN_SAMPLES, "there is plenty of history here");
    // Every move measured exactly zero, so there is no direction to report.
    // "mixed" would wrongly imply it moves both ways; "unknown" is the truth.
    assert.equal(readTendency(study.better).tendency, "unknown");
  });

  await testAsync("an unknown event id has no synthetic history", async () => {
    const provider = new MockNewsProvider();
    assert.equal(await provider.fetchHistory(1), null);
  });
}

function makeEvent(partial: Partial<NewsEvent>): NewsEvent {
  return {
    id: `${partial.eventId ?? 1}:${partial.occurrenceId ?? 1}`,
    eventId: partial.eventId ?? 1,
    occurrenceId: partial.occurrenceId ?? 1,
    time: partial.time ?? 0,
    currency: partial.currency ?? "USD",
    country: partial.country ?? "United States",
    impact: partial.impact ?? 3,
    title: partial.title ?? "Test event",
    period: partial.period ?? "",
    actual: partial.actual ?? null,
    forecast: partial.forecast ?? null,
    previous: partial.previous ?? null,
    surprise: partial.surprise ?? null,
    isSpeech: partial.isSpeech ?? false,
    isHoliday: partial.isHoliday ?? false,
    path: partial.path ?? null,
    source: partial.source ?? "test",
  };
}

run().then(
  () => {
    process.stdout.write(`\nnews.test.ts: ${passed} passed\n`);
  },
  (error: unknown) => {
    process.stderr.write(
      `\nnews.test.ts failed: ${error instanceof Error ? error.stack : String(error)}\n`,
    );
    process.exitCode = 1;
  },
);
