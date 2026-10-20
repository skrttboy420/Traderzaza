import type { Candle, Timeframe } from "@atc/types";
import type { CandleRequest, CandleResponse, MarketDataProvider } from "./types";
import { ProviderError, TIMEFRAME_SECONDS, buildStatus } from "./types";

const SYMBOL_MAP: Record<string, string> = {
  EURUSD: "EURUSD=X",
  GBPUSD: "GBPUSD=X",
  USDJPY: "USDJPY=X",
};

/**
 * Which Yahoo interval to ask for. Yahoo has no 4h bar, so 4h is built from 1h
 * — those are UTC-aligned, so the buckets land where Binance's 4h bars do.
 */
const SOURCE_INTERVAL: Record<Timeframe, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "4h": "1h",
  "1d": "1d",
};

/** How far back Yahoo serves each interval. Asking for more returns an error. */
const MAX_LOOKBACK_SECONDS: Record<string, number> = {
  "1m": 7 * 86400,
  "5m": 60 * 86400,
  "15m": 60 * 86400,
  "30m": 60 * 86400,
  "1h": 730 * 86400,
  "1d": 50 * 365 * 86400,
};

interface YahooChart {
  chart?: {
    result?:
      | {
          timestamp?: number[];
          indicators?: {
            quote?: {
              open?: (number | null)[];
              high?: (number | null)[];
              low?: (number | null)[];
              close?: (number | null)[];
              volume?: (number | null)[];
            }[];
          };
        }[]
      | null;
    error?: { code?: string; description?: string } | null;
  };
}

function mergeInto(target: Candle, extra: Candle): void {
  target.high = Math.max(target.high, extra.high);
  target.low = Math.min(target.low, extra.low);
  target.close = extra.close;
  target.volume += extra.volume;
}

/**
 * Turns Yahoo's raw rows into the series the engine expects: sorted, snapped to
 * evenly spaced buckets, and trimmed to `limit`.
 *
 * Snapping does two jobs at once. Yahoo appends the current quote as an extra
 * row stamped with "now" rather than the bar's open time, which would otherwise
 * leave the series ending on an unaligned candle; and 4h bars have to be built
 * from 1h ones because Yahoo has no 4h interval. Intraday bars already sit on
 * UTC boundaries, so snapping is a no-op for the completed ones.
 *
 * Daily bars are left alone: Yahoo stamps those at the exchange's midnight
 * (23:00 UTC for FX in summer), so snapping to a UTC day would redate them.
 *
 * Exported so the awkward parts can be tested without a network call.
 */
export function normaliseYahooRows(rows: Candle[], targetSeconds: number, limit: number): Candle[] {
  const sorted = [...rows].sort((a, b) => a.time - b.time);
  if (targetSeconds >= 86400) {
    return sorted.length > limit ? sorted.slice(sorted.length - limit) : sorted;
  }

  const out: Candle[] = [];
  for (const candle of sorted) {
    const time = Math.floor(candle.time / targetSeconds) * targetSeconds;
    const last = out[out.length - 1];
    if (last && last.time === time) {
      mergeInto(last, candle);
    } else {
      out.push({ ...candle, time });
    }
  }

  return out.length > limit ? out.slice(out.length - limit) : out;
}

/**
 * Yahoo Finance chart endpoint. No API key, no rate-limit sign-up, and the FX
 * quotes measure about a minute old — so EURUSD, GBPUSD and USDJPY are
 * genuinely LIVE with nothing to configure.
 *
 * Two things Yahoo does not give us: there is no XAUUSD spot symbol (gold is
 * handled elsewhere), and FX volume is always 0, so the engine's volume checks
 * stay silent on these pairs.
 */
export class YahooFinanceProvider implements MarketDataProvider {
  readonly name = "yahoo";
  readonly quality = "LIVE" as const;
  /** Keyless and unlimited as far as this app is concerned. */
  readonly metered = false;
  private readonly baseUrl: string;

  constructor(baseUrl = "https://query1.finance.yahoo.com") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  supports(symbol: string): boolean {
    return SYMBOL_MAP[symbol.toUpperCase()] !== undefined;
  }

  async fetchCandles(request: CandleRequest): Promise<CandleResponse> {
    const mapped = SYMBOL_MAP[request.symbol.toUpperCase()];
    if (!mapped) throw new ProviderError(this.name, `symbol not mapped: ${request.symbol}`);

    const interval = SOURCE_INTERVAL[request.timeframe];
    const targetSeconds = TIMEFRAME_SECONDS[request.timeframe];
    const limit = Math.min(Math.max(request.limit, 1), 2000);

    const period2 = request.endTime ?? Math.floor(Date.now() / 1000);
    let period1: number;
    if (request.startTime !== undefined) {
      period1 = request.startTime;
    } else {
      // FX stops over the weekend, so a window sized purely on bar count comes
      // back short. 1.5x the span plus three days covers the gap at every
      // timeframe without ever exceeding Yahoo's per-interval history limit.
      const span = Math.ceil(limit * targetSeconds * 1.5) + 3 * 86400;
      const cap = MAX_LOOKBACK_SECONDS[interval] ?? span;
      period1 = period2 - Math.min(span, cap);
    }

    const url = new URL(`${this.baseUrl}/v8/finance/chart/${mapped}`);
    url.searchParams.set("interval", interval);
    url.searchParams.set("period1", String(Math.max(period1, 0)));
    url.searchParams.set("period2", String(period2));

    const response = await fetch(url.toString(), {
      headers: {
        accept: "application/json",
        // The endpoint answers 404 to clients it does not recognise.
        "user-agent": "Mozilla/5.0 (compatible; AI-Trading-Coach)",
      },
    });
    if (!response.ok) {
      throw new ProviderError(this.name, `chart request failed: ${response.statusText}`, response.status);
    }

    const payload = (await response.json()) as YahooChart;
    const error = payload.chart?.error;
    if (error) {
      throw new ProviderError(this.name, error.description ?? error.code ?? "chart error");
    }

    const result = payload.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    const times = result?.timestamp;
    if (!result || !quote || !times) throw new ProviderError(this.name, "unexpected chart payload");

    const rows: Candle[] = [];
    for (let i = 0; i < times.length; i++) {
      const time = times[i];
      const open = quote.open?.[i];
      const high = quote.high?.[i];
      const low = quote.low?.[i];
      const close = quote.close?.[i];
      // Yahoo pads gaps with nulls rather than omitting the slot.
      if (
        time === undefined ||
        open === null ||
        open === undefined ||
        high === null ||
        high === undefined ||
        low === null ||
        low === undefined ||
        close === null ||
        close === undefined
      ) {
        continue;
      }
      if (!Number.isFinite(time) || !Number.isFinite(close)) continue;
      rows.push({ time, open, high, low, close, volume: quote.volume?.[i] ?? 0 });
    }

    const candles = normaliseYahooRows(rows, targetSeconds, limit);
    if (candles.length === 0) throw new ProviderError(this.name, "no candles parsed");

    return {
      candles,
      status: buildStatus({ quality: "LIVE", provider: this.name, candles }),
    };
  }

  subscribe(): null {
    // REST only — Yahoo has no public streaming endpoint. The UI polls instead.
    return null;
  }
}

export function yahooSymbol(symbol: string): string | null {
  return SYMBOL_MAP[symbol.toUpperCase()] ?? null;
}
