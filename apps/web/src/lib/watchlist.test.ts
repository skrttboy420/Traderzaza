import assert from "node:assert/strict";
import test from "node:test";

import { ASSETS, DEFAULT_WATCHLIST, getAsset } from "@atc/market-data";

import {
  WATCHLIST_COOKIE,
  parseWatchlist,
  readWatchlistCookie,
  serializeWatchlist,
  toggleWatchlist,
  writeWatchlistCookie,
} from "./watchlist";

/**
 * The cookie that decides what the server pays for.
 *
 * This is the one piece of user-controlled input in the app that directly
 * drives metered spending: whatever survives `parseWatchlist` becomes a list
 * of symbols the server fetches four timeframes each for, against an allowance
 * of eight credits a minute. So the parser is written as a validator, and the
 * three things it must never do are pinned here — never hand the scanner a
 * symbol the asset catalogue does not know (that throws in `requireAsset`),
 * never multiply the spend through repetition, and never return an empty list.
 *
 * The last one is not a cost bug but a truthfulness bug, and the worse of the
 * two: a scan of nothing renders exactly like a scan that found nothing, and
 * this app's whole posture is that those two must never look alike.
 */

/** Minimal cookie jar, so the browser half can be tested rather than assumed. */
function withDocument(run: () => void): void {
  const host = globalThis as { document?: unknown };
  const original = Object.prototype.hasOwnProperty.call(host, "document")
    ? host.document
    : undefined;
  let jar = "";

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      get cookie(): string {
        return jar;
      },
      set cookie(next: string) {
        // A real browser stores the pair and discards the attributes.
        jar = next.split(";")[0] ?? "";
      },
    },
  });

  try {
    run();
  } finally {
    if (original === undefined) delete host.document;
    else Object.defineProperty(globalThis, "document", { configurable: true, value: original });
  }
}

test("no cookie scans everything rather than nothing", () => {
  assert.deepEqual(parseWatchlist(undefined), [...DEFAULT_WATCHLIST]);
  assert.deepEqual(parseWatchlist(null), [...DEFAULT_WATCHLIST]);
  assert.deepEqual(parseWatchlist(""), [...DEFAULT_WATCHLIST]);
});

test("a symbol the catalogue does not know never reaches the scanner", () => {
  // requireAsset throws on an unknown symbol, so a stale cookie written by an
  // older build — or typed by hand — would otherwise take down every scanning
  // screen at once rather than degrade.
  const parsed = parseWatchlist("XAUUSD,DOGECOIN,BTCUSDT");
  assert.deepEqual(parsed, ["XAUUSD", "BTCUSDT"]);
  for (const symbol of parsed) {
    assert.ok(getAsset(symbol), `${symbol} must be a real asset`);
  }
});

test("a cookie with nothing usable in it falls back to the default", () => {
  // Not to an empty list. An empty scan draws the same screen as a scan that
  // found no setups, and the user would read a broken cookie as a quiet market.
  assert.deepEqual(parseWatchlist("NOTREAL,ALSOFAKE"), [...DEFAULT_WATCHLIST]);
  assert.deepEqual(parseWatchlist(",,, ,"), [...DEFAULT_WATCHLIST]);
});

test("repetition cannot multiply what the scan costs", () => {
  const parsed = parseWatchlist("XAUUSD,XAUUSD,xauusd,XAUUSD");
  assert.deepEqual(parsed, ["XAUUSD"], "one symbol, however many times it is listed");
  assert.ok(
    parseWatchlist(new Array(500).fill("XAUUSD,EURUSD").join(",")).length <= ASSETS.length,
    "the catalogue is the ceiling on how much a cookie can ask for",
  );
});

test("a malformed percent-escape does not take the server render down", () => {
  // decodeURIComponent throws on a lone '%'. Unhandled, that is a 500 on every
  // scanning screen, triggered by a value the user can edit in devtools.
  assert.doesNotThrow(() => parseWatchlist("%"));
  assert.deepEqual(parseWatchlist("%"), [...DEFAULT_WATCHLIST]);
  assert.deepEqual(parseWatchlist("XAUUSD%2CBTCUSDT"), ["XAUUSD", "BTCUSDT"]);
});

test("what the browser writes is what the server reads back", () => {
  // The comma separator is percent-encoded on the way out, so an asymmetry
  // here would silently collapse six symbols into one unknown token — and the
  // fallback would hide it by scanning everything, which is the default the
  // user was trying to get away from.
  withDocument(() => {
    writeWatchlistCookie(["XAUUSD", "BTCUSDT"]);
    assert.ok(document.cookie.startsWith(`${WATCHLIST_COOKIE}=`));
    assert.deepEqual(readWatchlistCookie(), ["XAUUSD", "BTCUSDT"]);

    const raw = document.cookie.slice(WATCHLIST_COOKIE.length + 1);
    assert.deepEqual(parseWatchlist(raw), ["XAUUSD", "BTCUSDT"], "the server parses the same bytes");
  });
});

test("a watchlist narrowed to one market stays narrowed", () => {
  // The whole point of the feature: a gold-only trader pays four credits a
  // scan instead of paying for five markets they never look at.
  withDocument(() => {
    writeWatchlistCookie(["XAUUSD"]);
    assert.deepEqual(readWatchlistCookie(), ["XAUUSD"]);
  });
  assert.equal(serializeWatchlist(["XAUUSD"]), "XAUUSD");
});

test("serialising cleans the list rather than trusting it", () => {
  assert.equal(serializeWatchlist(["btcusdt", "NOPE", "btcusdt"]), "BTCUSDT");
});

test("a burst of clicks removes every market that was clicked", () => {
  // React batches clicks landing in the same tick into one render. A handler
  // that read the selection from its closure would start each click in the
  // burst from the same list, so all but the last would be dropped — the user
  // unticks four markets, sees three still ticked, and keeps paying for them.
  // Folding the toggles proves the result depends only on what was passed in.
  const start = [...DEFAULT_WATCHLIST];
  const removed = ["EURUSD", "GBPUSD", "USDJPY", "BTCUSDT"];
  const after = removed.reduce((list, symbol) => toggleWatchlist(list, symbol), start);

  assert.deepEqual(after, ["XAUUSD", "ETHUSDT"], "every click in the burst counts");
  assert.deepEqual(start, [...DEFAULT_WATCHLIST], "and the list handed in is never mutated");
});

test("removing the last market is refused rather than silently reversed", () => {
  // An empty cookie reads as "no preference" and falls back to the full
  // default, so emptying the list would widen the scan to all six markets —
  // the exact opposite of the press, and billed for it.
  assert.deepEqual(toggleWatchlist(["XAUUSD"], "XAUUSD"), ["XAUUSD"]);
  assert.deepEqual(parseWatchlist(toggleWatchlist(["XAUUSD"], "XAUUSD").join(",")), ["XAUUSD"]);
});

test("a market ticked back on returns to its place in the catalogue", () => {
  // Appending instead would move it to the bottom of the dashboard, so turning
  // a market off and on again would reorder the screen under the user.
  const withoutGold = toggleWatchlist([...DEFAULT_WATCHLIST], "XAUUSD");
  assert.equal(withoutGold.includes("XAUUSD"), false);
  assert.deepEqual(
    toggleWatchlist(withoutGold, "XAUUSD"),
    [...DEFAULT_WATCHLIST],
    "back exactly where it was, not appended",
  );
});

test("toggling cannot introduce a symbol the scanner would choke on", () => {
  // Same contract as the cookie parser: whatever this returns is handed
  // straight to the scanner, and requireAsset throws on an unknown symbol.
  assert.deepEqual(toggleWatchlist(["XAUUSD"], "DOGECOIN"), ["XAUUSD"], "unknown symbols are not added");
  for (const symbol of toggleWatchlist(["XAUUSD", "NOTREAL"], "EURUSD")) {
    assert.ok(getAsset(symbol), `${symbol} must be a real asset`);
  }
});
