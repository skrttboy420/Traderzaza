import type { Candle, Timeframe } from "@atc/types";
import type { CandleRequest, CandleResponse, MarketDataProvider } from "./types";
import { ProviderError, buildStatus } from "./types";

const INTERVALS: Record<Timeframe, string> = {
  "1m": "1min",
  "5m": "5min",
  "15m": "15min",
  "30m": "30min",
  "1h": "1h",
  "4h": "4h",
  "1d": "1day",
};

const SYMBOL_MAP: Record<string, string> = {
  XAUUSD: "XAU/USD",
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
  USDJPY: "USD/JPY",
  XAGUSD: "XAG/USD",
};

interface TwelveDataSeries {
  values?: { datetime: string; open: string; high: string; low: string; close: string; volume?: string }[];
  status?: string;
  message?: string;
}

/** What the free "basic" plan allows. One `time_series` call costs one credit. */
export const FREE_TIER_CREDITS: CreditLimits = { perMinute: 8, perDay: 800 };

export interface CreditLimits {
  perMinute: number;
  perDay: number;
}

export interface CreditSnapshot {
  minuteUsed: number;
  minuteLimit: number;
  dayUsed: number;
  dayLimit: number;
}

/**
 * A spend counter for the free tier, checked *before* each call.
 *
 * The arithmetic is the whole reason this exists. One watchlist scan asks for
 * the mandatory 4H/1H/15M/5M chain, so gold alone costs four credits — half the
 * per-minute allowance. Two page loads inside a minute exhaust it and the third
 * gets a 429, which `MarketDataService` would otherwise turn into DEMO candles
 * on a screen the trader is reading for real levels.
 *
 * Refusing early is strictly better than learning the limit from the far end:
 * the request is not wasted, the error arrives instantly instead of after a
 * round trip, and the service can fall back to the stale-but-real cache rather
 * than to synthetic prices.
 *
 * Two honest limits on this. The count starts at zero when the process starts,
 * so credits already spent by another instance — or by a different machine
 * sharing the key — are invisible to it; on a serverless host each instance
 * keeps its own tally and the true total can run higher. And the daily window
 * is UTC, which is an assumption about when the plan resets. Neither is a
 * correctness problem, because a real 429 still degrades gracefully. This is a
 * budget that avoids the common case, not a distributed quota manager.
 */
export class CreditBudget {
  private readonly limits: CreditLimits;
  private minuteWindow: number[] = [];
  private dayUsed = 0;
  private dayStamp = "";

  constructor(limits: CreditLimits = FREE_TIER_CREDITS) {
    this.limits = limits;
  }

  private prune(now: number): void {
    this.minuteWindow = this.minuteWindow.filter((t) => now - t < 60_000);
    const day = new Date(now).toISOString().slice(0, 10);
    if (day !== this.dayStamp) {
      this.dayStamp = day;
      this.dayUsed = 0;
    }
  }

  /** Books one credit if there is room. Returns false when there is not. */
  tryConsume(now: number = Date.now()): boolean {
    this.prune(now);
    if (this.minuteWindow.length >= this.limits.perMinute) return false;
    if (this.dayUsed >= this.limits.perDay) return false;
    this.minuteWindow.push(now);
    this.dayUsed += 1;
    return true;
  }

  snapshot(now: number = Date.now()): CreditSnapshot {
    this.prune(now);
    return {
      minuteUsed: this.minuteWindow.length,
      minuteLimit: this.limits.perMinute,
      dayUsed: this.dayUsed,
      dayLimit: this.limits.perDay,
    };
  }
}

/** `2026-10-02 12:30:00` — the shape TwelveData's date params expect. */
function toApiDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * TwelveData covers forex, metals, indices, stocks and ETFs. The free tier is
 * delayed, so quality is reported as DELAYED unless the caller says otherwise.
 */
export class TwelveDataProvider implements MarketDataProvider {
  readonly name = "twelvedata";
  readonly quality: "LIVE" | "DELAYED";
  /** The only feed here that can run out. One `time_series` call, one credit. */
  readonly metered = true;
  /**
   * `outputsize` tops out at 5000. Measured on the free tier: four sequential
   * pages walked 15m gold back seven months, so the depth limit here is the
   * page budget we choose, not anything the API imposes.
   */
  readonly maxBarsPerCall = 5000;
  readonly budget: CreditBudget;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(
    apiKey: string,
    quality: "LIVE" | "DELAYED" = "DELAYED",
    baseUrl = "https://api.twelvedata.com",
    budget: CreditBudget = new CreditBudget(),
  ) {
    this.apiKey = apiKey;
    this.quality = quality;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.budget = budget;
  }

  supports(symbol: string): boolean {
    return this.apiKey.length > 0 && SYMBOL_MAP[symbol.toUpperCase()] !== undefined;
  }

  async fetchCandles(request: CandleRequest): Promise<CandleResponse> {
    const mapped = SYMBOL_MAP[request.symbol.toUpperCase()];
    if (!mapped) throw new ProviderError(this.name, `symbol not mapped: ${request.symbol}`);

    // Checked before the request is built, not after it fails. The caller
    // treats this like any other provider failure, which means the cached
    // real candles win over the demo generator.
    if (!this.budget.tryConsume()) {
      const { minuteUsed, minuteLimit, dayUsed, dayLimit } = this.budget.snapshot();
      throw new ProviderError(
        this.name,
        `free-tier credits exhausted (${minuteUsed}/${minuteLimit} this minute, ${dayUsed}/${dayLimit} today)`,
        429,
      );
    }

    const url = new URL(`${this.baseUrl}/time_series`);
    url.searchParams.set("symbol", mapped);
    url.searchParams.set("interval", INTERVALS[request.timeframe]);
    const sliced = request.startTime !== undefined || request.endTime !== undefined;
    url.searchParams.set(
      "outputsize",
      String(sliced ? Math.min(Math.max(request.limit, 1), 5000) : Math.min(Math.max(request.limit, 50), 5000)),
    );
    url.searchParams.set("order", "ASC");
    // Every datetime in this exchange, in and out, is naive. Unset, the API
    // reads `start_date` AND writes every row's `datetime` in the instrument's
    // local exchange time, while reporting `exchange_timezone: null` — and line
    // ~182 below parses those rows as UTC. For XAU/USD that exchange sits at
    // UTC+11 under southern-hemisphere DST, so every gold candle arrived
    // stamped eleven hours in the future: a chart whose newest bar was
    // tomorrow, a "last update" that counted backwards, and a staleness check
    // comparing now against a future time. The prices were right the whole
    // time — only the clock on them was wrong. The offset also moves with DST,
    // so it cannot be corrected after the fact; it has to be asked for.
    url.searchParams.set("timezone", "UTC");
    if (request.startTime !== undefined) url.searchParams.set("start_date", toApiDate(request.startTime));
    if (request.endTime !== undefined) url.searchParams.set("end_date", toApiDate(request.endTime));
    url.searchParams.set("apikey", this.apiKey);

    const response = await fetch(url.toString(), { headers: { accept: "application/json" } });
    if (!response.ok) {
      throw new ProviderError(this.name, `time_series request failed: ${response.statusText}`, response.status);
    }

    const payload = (await response.json()) as TwelveDataSeries;
    if (payload.status === "error" || !payload.values) {
      throw new ProviderError(this.name, payload.message ?? "no series returned");
    }

    const candles: Candle[] = [];
    for (const row of payload.values) {
      const time = Math.floor(Date.parse(`${row.datetime.replace(" ", "T")}Z`) / 1000);
      if (!Number.isFinite(time)) continue;
      candles.push({
        time,
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume ?? 0),
      });
    }
    candles.sort((a, b) => a.time - b.time);

    if (candles.length === 0) throw new ProviderError(this.name, "no candles parsed");

    return {
      candles,
      status: buildStatus({
        quality: this.quality,
        provider: this.name,
        candles,
        ...(this.quality === "DELAYED"
          ? { note: "Free-tier data is delayed. Re-check levels against your broker feed before executing." }
          : {}),
      }),
    };
  }

  subscribe(): null {
    // REST only in this implementation; the UI polls on an interval instead.
    return null;
  }
}

export function twelveDataSymbol(symbol: string): string | null {
  return SYMBOL_MAP[symbol.toUpperCase()] ?? null;
}
