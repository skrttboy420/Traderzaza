import { ASSETS, DEFAULT_WATCHLIST, getAsset } from "@atc/market-data";

/**
 * The watchlist, shared between the browser and the server render.
 *
 * Settings live in localStorage, which the server cannot read, so every
 * scanning screen used to scan the full six-symbol default no matter what the
 * user had chosen — the watchlist editor on the settings screen changed
 * nothing that costs money. On a metered feed that is not a cosmetic gap: gold
 * alone is four of the eight credits a minute allows, so a trader who only
 * watches gold was paying for five markets they never look at.
 *
 * A cookie is the bridge because the watchlist is a *persistent* preference.
 * A URL parameter would only apply to whichever link carried it, so the four
 * scanning screens would disagree with each other and a bookmark would quietly
 * resurrect an old selection. The cookie is read on every server render, so all
 * four agree and the choice survives a reload.
 *
 * Deliberately not httpOnly: the browser writes it. There is nothing sensitive
 * in a list of six public tickers, and the alternative — a round trip to a
 * route handler to set it — buys nothing.
 */
export const WATCHLIST_COOKIE = "atc.watchlist";

/** A year. The watchlist is a preference, not a session. */
export const WATCHLIST_COOKIE_MAX_AGE = 31_536_000;

/**
 * Read a cookie value into a watchlist the scanner can be trusted with.
 *
 * Cookies are user-controlled input that here decides how many metered
 * requests the server makes, so this validates rather than parses: anything
 * not in the asset catalogue is dropped, duplicates collapse, and the result
 * can never be longer than the catalogue itself. A hand-edited cookie can
 * therefore narrow the scan or reorder it, but it cannot make the server spend
 * more than a default page load already does.
 *
 * An empty or unreadable value falls back to the full default. Scanning
 * nothing would render an empty dashboard that looks exactly like a quiet
 * market, and that is the one confusion this app works hardest to avoid.
 */
export function parseWatchlist(raw: string | null | undefined): string[] {
  if (!raw) return [...DEFAULT_WATCHLIST];

  // Percent-decoding is both conditional and fallible: some cookie readers
  // decode for us and a malformed value throws, which here would take down
  // every server-rendered screen at once. Symbols contain no percent signs, so
  // decoding twice is harmless and not decoding at all still parses.
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Keep the raw value; the validation below discards whatever is left.
  }

  const seen = new Set<string>();
  for (const part of decoded.split(",")) {
    const symbol = part.trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    if (!getAsset(symbol)) continue;
    seen.add(symbol);
  }

  return seen.size > 0 ? [...seen] : [...DEFAULT_WATCHLIST];
}

export function serializeWatchlist(symbols: string[]): string {
  return parseWatchlist(symbols.join(",")).join(",");
}

/**
 * Add or remove one market, returning the new selection.
 *
 * Derived from the list passed in rather than from a captured render value, so
 * the caller can apply it inside a state updater. That is not a style
 * preference: React batches clicks that land in the same tick, and a handler
 * that computed from the closure would have every click in a burst start from
 * the same list, so all but the last would be silently discarded. Unticking
 * four markets in a hurry would leave three of them on, still being paid for.
 *
 * Re-ticking restores catalogue order instead of appending, so a market coming
 * back does not shuffle the dashboard underneath it.
 *
 * Removing the last market is refused. An empty cookie is read as "no
 * preference" and falls back to the full default, so the one press that should
 * narrow the scan the most would instead widen it to everything — the opposite
 * of what the user asked for, and billed accordingly.
 */
export function toggleWatchlist(selected: readonly string[], symbol: string): string[] {
  const target = symbol.toUpperCase();
  const current = selected.map((s) => s.toUpperCase()).filter((s) => getAsset(s));

  if (current.includes(target)) {
    const next = current.filter((s) => s !== target);
    return next.length > 0 ? next : current;
  }

  // Rebuilding from the catalogue is what keeps an unknown symbol out: one
  // that is not in ASSETS matches nothing and simply never appears. No
  // separate guard, because a guard this one cannot fail independently of the
  // filter is a line no test can hold to account.
  return ASSETS.filter((a) => a.symbol === target || current.includes(a.symbol)).map((a) => a.symbol);
}

/**
 * Publish the selection to the server. No-op outside the browser.
 *
 * `lax` rather than `strict` so the list survives arriving from an external
 * link, which is how a shared setup URL is opened. Secure only on https, since
 * development runs on plain http and a cookie the browser refuses is a
 * watchlist that silently resets.
 */
export function writeWatchlistCookie(symbols: string[]): void {
  if (typeof document === "undefined") return;
  const value = encodeURIComponent(serializeWatchlist(symbols));
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${WATCHLIST_COOKIE}=${value}; path=/; max-age=${WATCHLIST_COOKIE_MAX_AGE}; samesite=lax${secure}`;
}

/** Reads the cookie back in the browser, for code that cannot wait for a render. */
export function readWatchlistCookie(): string[] {
  if (typeof document === "undefined") return [...DEFAULT_WATCHLIST];
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${WATCHLIST_COOKIE}=`));
  return parseWatchlist(match?.slice(WATCHLIST_COOKIE.length + 1));
}
