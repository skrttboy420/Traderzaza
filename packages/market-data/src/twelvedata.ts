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
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, quality: "LIVE" | "DELAYED" = "DELAYED", baseUrl = "https://api.twelvedata.com") {
    this.apiKey = apiKey;
    this.quality = quality;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  supports(symbol: string): boolean {
    return this.apiKey.length > 0 && SYMBOL_MAP[symbol.toUpperCase()] !== undefined;
  }

  async fetchCandles(request: CandleRequest): Promise<CandleResponse> {
    const mapped = SYMBOL_MAP[request.symbol.toUpperCase()];
    if (!mapped) throw new ProviderError(this.name, `symbol not mapped: ${request.symbol}`);

    const url = new URL(`${this.baseUrl}/time_series`);
    url.searchParams.set("symbol", mapped);
    url.searchParams.set("interval", INTERVALS[request.timeframe]);
    const sliced = request.startTime !== undefined || request.endTime !== undefined;
    url.searchParams.set(
      "outputsize",
      String(sliced ? Math.min(Math.max(request.limit, 1), 5000) : Math.min(Math.max(request.limit, 50), 5000)),
    );
    url.searchParams.set("order", "ASC");
    // The API accepts naive datetimes, so the timezone has to be stated or it
    // silently interprets them in the exchange's local time.
    if (sliced) url.searchParams.set("timezone", "UTC");
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
