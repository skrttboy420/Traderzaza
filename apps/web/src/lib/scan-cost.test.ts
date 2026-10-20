import assert from "node:assert/strict";
import test from "node:test";

import { hasMeteredFeed, selectionPrice } from "./scan-cost";
import type { ScanCostReport } from "./scan-cost";

/**
 * The price shown next to the refresh button, and the rule for when to show it.
 *
 * Both are pure functions here rather than inline in the component for the same
 * reason: they encode claims a screenshot cannot check. The sum has to match
 * what the server would charge, or the number talks the user into a press they
 * cannot afford. And the visibility rule has to survive the user doing exactly
 * what the feature invites — unticking the expensive market.
 */

/**
 * The real shape, as served by `GET /api/scan-cost` on this deployment: gold on
 * the metered feed, every other market keyless. The baseline is zero because
 * the dollar basket is three Yahoo pairs.
 */
function report(overrides: Partial<ScanCostReport> = {}): ScanCostReport {
  return {
    baseline: 0,
    baselineFull: 0,
    perSymbol: [
      { symbol: "XAUUSD", provider: "twelvedata", metered: true, credits: 4, fullCredits: 4 },
      { symbol: "EURUSD", provider: "yahoo", metered: false, credits: 0, fullCredits: 0 },
      { symbol: "GBPUSD", provider: "yahoo", metered: false, credits: 0, fullCredits: 0 },
      { symbol: "USDJPY", provider: "yahoo", metered: false, credits: 0, fullCredits: 0 },
      { symbol: "BTCUSDT", provider: "binance", metered: false, credits: 0, fullCredits: 0 },
      { symbol: "ETHUSDT", provider: "binance", metered: false, credits: 0, fullCredits: 0 },
    ],
    selected: ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSDT", "ETHUSDT"],
    quota: { minuteUsed: 0, minuteLimit: 8, dayUsed: 0, dayLimit: 800 },
    ...overrides,
  };
}

test("unticking the only metered market does not remove the way to tick it back on", () => {
  // The trap this function exists to avoid. The chip showing the price is also
  // the only entry point to the market picker, so a visibility rule that read
  // the *selection* would delete the control the moment it was used as
  // intended: drop gold, the total falls to zero, the chip vanishes, and gold
  // can never be restored from the header again.
  const cost = report();
  const withoutGold = ["EURUSD", "GBPUSD", "USDJPY", "BTCUSDT", "ETHUSDT"];

  assert.equal(selectionPrice(cost, withoutGold).full, 0, "nothing left in the selection costs credits");
  assert.ok(hasMeteredFeed(cost), "but the picker must still be reachable");
  assert.equal(
    hasMeteredFeed(cost),
    hasMeteredFeed({ ...cost, selected: withoutGold }),
    "visibility is a property of the catalogue, never of the selection",
  );
});

test("a deployment with no metered feed shows no price at all", () => {
  // No TwelveData key: every market is keyless, there is no budget to manage,
  // and a permanent "0" next to the button would be noise rather than information.
  const keyless = report({
    perSymbol: report().perSymbol.map((row) => ({ ...row, metered: false, credits: 0, fullCredits: 0 })),
    quota: null,
  });
  assert.equal(hasMeteredFeed(keyless), false);
});

test("the quoted total is the sum of the rows the server priced", () => {
  // Per-symbol costs are marginal over the baseline, so adding them is exact
  // rather than an approximation. If this drifted, the chip and the actual
  // charge would disagree in the one number the user checks before pressing.
  const cost = report();
  assert.deepEqual(selectionPrice(cost, ["XAUUSD"]), { now: 4, full: 4 });
  assert.deepEqual(selectionPrice(cost, ["BTCUSDT", "ETHUSDT"]), { now: 0, full: 0 });
  assert.deepEqual(selectionPrice(cost, cost.selected), { now: 4, full: 4 }, "gold is the whole bill");
});

test("a warm cache is quoted free without hiding what it costs cold", () => {
  // Immediately after a scan the candles are fresh, so pressing again reaches
  // no provider and genuinely costs nothing. Reporting only that would teach
  // the user that refreshing is permanently free.
  const warm = report({
    perSymbol: report().perSymbol.map((row) => ({ ...row, credits: 0 })),
  });
  const price = selectionPrice(warm, warm.selected);
  assert.equal(price.now, 0, "free this instant");
  assert.equal(price.full, 4, "and four credits once the bars age");
});

test("the baseline is charged even when the watchlist is empty", () => {
  // The dollar basket loads whatever the user selected, so it belongs in every
  // quote. Zero while Yahoo serves the pairs, but not zero by definition.
  const paidBasket = report({ baseline: 3, baselineFull: 3 });
  assert.deepEqual(selectionPrice(paidBasket, []), { now: 3, full: 3 });
});

test("a symbol the catalogue has dropped is ignored rather than thrown over", () => {
  // The selection comes from localStorage and can outlive a release that
  // retires an asset. Crashing here would take out the whole header.
  const cost = report();
  assert.deepEqual(selectionPrice(cost, ["XAUUSD", "XAGUSD"]), { now: 4, full: 4 });
  assert.deepEqual(selectionPrice(cost, ["xauusd"]), { now: 4, full: 4 }, "case is not significance");
});
