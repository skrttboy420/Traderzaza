import type { Asset } from "@atc/types";

/**
 * Asset catalogue. Adding an index, stock or ETF only needs a new entry here
 * plus a provider that supports the symbol — no engine or UI changes.
 */
export const ASSETS: Asset[] = [
  {
    symbol: "XAUUSD",
    display: "Gold / USD",
    assetClass: "metal",
    minTick: 0.01,
    pipSize: 0.1,
    // 1 standard lot = 100 oz, so a 0.1 move is 10 units of account currency.
    pipValuePerLot: 10,
    quote: "USD",
  },
  {
    symbol: "EURUSD",
    display: "Euro / USD",
    assetClass: "forex",
    minTick: 0.00001,
    pipSize: 0.0001,
    pipValuePerLot: 10,
    quote: "USD",
  },
  {
    symbol: "GBPUSD",
    display: "Pound / USD",
    assetClass: "forex",
    minTick: 0.00001,
    pipSize: 0.0001,
    pipValuePerLot: 10,
    quote: "USD",
  },
  {
    symbol: "USDJPY",
    display: "USD / Yen",
    assetClass: "forex",
    minTick: 0.001,
    pipSize: 0.01,
    // Quote currency is JPY, so pip value in USD varies with the rate.
    // 9.1 is a working approximation around 110-155; the calculator warns about it.
    pipValuePerLot: 9.1,
    quote: "JPY",
  },
  {
    symbol: "BTCUSDT",
    display: "Bitcoin / USDT",
    assetClass: "crypto",
    minTick: 0.01,
    pipSize: 1,
    pipValuePerLot: null,
    quote: "USDT",
  },
  {
    symbol: "ETHUSDT",
    display: "Ethereum / USDT",
    assetClass: "crypto",
    minTick: 0.01,
    pipSize: 0.1,
    pipValuePerLot: null,
    quote: "USDT",
  },
];

const BY_SYMBOL = new Map(ASSETS.map((a) => [a.symbol, a]));

export function getAsset(symbol: string): Asset | null {
  return BY_SYMBOL.get(symbol.toUpperCase()) ?? null;
}

export function requireAsset(symbol: string): Asset {
  const asset = getAsset(symbol);
  if (!asset) throw new Error(`Unknown asset: ${symbol}`);
  return asset;
}

export const DEFAULT_WATCHLIST = ASSETS.map((a) => a.symbol);

/** Rough starting price per symbol, used only by the demo generator. */
export const REFERENCE_PRICES: Record<string, number> = {
  XAUUSD: 2650,
  EURUSD: 1.0850,
  GBPUSD: 1.2720,
  USDJPY: 151.4,
  BTCUSDT: 96000,
  ETHUSDT: 3300,
};
