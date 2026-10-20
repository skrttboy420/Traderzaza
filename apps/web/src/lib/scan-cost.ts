/**
 * The arithmetic behind the price shown next to the refresh button.
 *
 * Kept out of the component because both functions here encode claims that are
 * easy to get wrong and impossible to check by looking at a screenshot: that
 * the client's running total can never disagree with the server's, and that the
 * control stays reachable no matter what the user selects.
 *
 * These types are the wire shape of `GET /api/scan-cost`. They live here rather
 * than in `scan.ts` so that reading them costs nothing: `scan.ts` pulls in
 * `next/headers` and the market-data service, neither of which a pure sum needs.
 */

export interface SymbolCostRow {
  symbol: string;
  provider: string;
  metered: boolean;
  /** Credits adding this symbol to the scan would spend right now. */
  credits: number;
  /** What it costs once the cache lapses — the price in the steady state. */
  fullCredits: number;
}

export interface CreditQuota {
  minuteUsed: number;
  minuteLimit: number;
  dayUsed: number;
  dayLimit: number;
}

export interface ScanCostReport {
  /**
   * Credits a scan spends before any symbol is chosen: the dollar basket,
   * which is loaded whatever the watchlist says. Zero while Yahoo serves the
   * three pairs, which is the normal case — it is reported anyway so the
   * arithmetic on screen adds up if Yahoo is ever switched off.
   */
  baseline: number;
  baselineFull: number;
  /** Every tradable symbol, priced whether or not it is currently selected. */
  perSymbol: SymbolCostRow[];
  /** What the server would scan right now, from the cookie. */
  selected: string[];
  quota: CreditQuota | null;
}

export interface SelectionPrice {
  /** Credits the selection would spend if refreshed this instant. */
  now: number;
  /** What the same press costs once the candles age out of the cache. */
  full: number;
}

/**
 * Price a selection by summing the symbols in it.
 *
 * A plain sum is only correct because the server reports each symbol's cost as
 * *marginal* over the baseline — the dollar basket, the one group of series two
 * symbols could otherwise share. With the overlap already removed, nothing is
 * double-counted and the client needs no round trip to re-price a toggle.
 *
 * Unknown symbols in `selected` contribute nothing rather than throwing. The
 * list comes from localStorage, so a build that drops an asset from the
 * catalogue would otherwise crash the header on the next visit.
 */
export function selectionPrice(cost: ScanCostReport, selected: readonly string[]): SelectionPrice {
  const wanted = new Set(selected.map((symbol) => symbol.toUpperCase()));
  const rows = cost.perSymbol.filter((row) => wanted.has(row.symbol.toUpperCase()));
  return {
    now: cost.baseline + rows.reduce((sum, row) => sum + row.credits, 0),
    full: cost.baselineFull + rows.reduce((sum, row) => sum + row.fullCredits, 0),
  };
}

/**
 * Whether this deployment has anything worth pricing.
 *
 * The question is about the *catalogue*, not the selection, and the difference
 * is a trap worth naming. The chip that shows the price is also the only way to
 * open the market picker. Hide it whenever the current selection happens to
 * cost nothing and the control deletes itself the moment it is used as
 * intended: unticking gold — the one metered market — drops the total to zero,
 * which hides the chip, which strands the user with no way to tick gold back on.
 *
 * So the test is whether any tradable symbol is metered at all. With no
 * TwelveData key every row is keyless, there is no budget to manage, and the
 * chip stays hidden as a permanent "0" would be noise. With a key it stays put
 * and is allowed to read zero.
 */
export function hasMeteredFeed(cost: ScanCostReport): boolean {
  return cost.perSymbol.some((row) => row.metered);
}
