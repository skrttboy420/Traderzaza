import type { Candle, Timeframe } from "@atc/types";
import type { CandleRequest, CandleResponse, MarketDataProvider } from "./types";
import { ProviderError, buildStatus } from "./types";

const INTERVALS: Record<Timeframe, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
};

const SUPPORTED = new Set(["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"]);

/**
 * Binance public klines. No API key required, so crypto is genuinely LIVE
 * out of the box.
 */
export class BinanceMarketDataProvider implements MarketDataProvider {
  readonly name = "binance";
  readonly quality = "LIVE" as const;
  private readonly baseUrl: string;

  constructor(baseUrl = "https://api.binance.com") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  supports(symbol: string): boolean {
    return SUPPORTED.has(symbol.toUpperCase());
  }

  async fetchCandles(request: CandleRequest): Promise<CandleResponse> {
    const interval = INTERVALS[request.timeframe];
    // A slice request asks for exactly as many candles as it needs, so the
    // usual 50-candle floor would widen the window the caller chose.
    const sliced = request.startTime !== undefined || request.endTime !== undefined;
    const limit = sliced
      ? Math.min(Math.max(request.limit, 1), 1000)
      : Math.min(Math.max(request.limit, 50), 1000);
    const url = new URL(`${this.baseUrl}/api/v3/klines`);
    url.searchParams.set("symbol", request.symbol.toUpperCase());
    url.searchParams.set("interval", interval);
    url.searchParams.set("limit", String(limit));
    // Binance speaks milliseconds.
    if (request.startTime !== undefined) url.searchParams.set("startTime", String(request.startTime * 1000));
    if (request.endTime !== undefined) url.searchParams.set("endTime", String(request.endTime * 1000));

    const response = await fetch(url.toString(), { headers: { accept: "application/json" } });
    if (!response.ok) {
      throw new ProviderError(this.name, `klines request failed: ${response.statusText}`, response.status);
    }

    const raw: unknown = await response.json();
    if (!Array.isArray(raw)) {
      throw new ProviderError(this.name, "unexpected klines payload");
    }

    const candles: Candle[] = [];
    for (const row of raw) {
      if (!Array.isArray(row)) continue;
      const time = Number(row[0]);
      const open = Number(row[1]);
      const high = Number(row[2]);
      const low = Number(row[3]);
      const close = Number(row[4]);
      const volume = Number(row[5]);
      if (!Number.isFinite(time) || !Number.isFinite(close)) continue;
      candles.push({ time: Math.floor(time / 1000), open, high, low, close, volume });
    }

    if (candles.length === 0) {
      throw new ProviderError(this.name, "no candles returned");
    }

    return {
      candles,
      status: buildStatus({ quality: "LIVE", provider: this.name, candles }),
    };
  }

  /** Kline websocket. Emits on every update; the caller decides what to redraw. */
  subscribe(
    request: { symbol: string; timeframe: Timeframe },
    onCandle: (candle: Candle) => void,
  ): (() => void) | null {
    if (typeof WebSocket === "undefined") return null;
    const stream = `${request.symbol.toLowerCase()}@kline_${INTERVALS[request.timeframe]}`;
    const socket = new WebSocket(`wss://stream.binance.com:9443/ws/${stream}`);

    socket.onmessage = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(String(event.data)) as {
          k?: { t: number; o: string; h: string; l: string; c: string; v: string };
        };
        const k = payload.k;
        if (!k) return;
        onCandle({
          time: Math.floor(k.t / 1000),
          open: Number(k.o),
          high: Number(k.h),
          low: Number(k.l),
          close: Number(k.c),
          volume: Number(k.v),
        });
      } catch {
        // A malformed frame is not fatal — the next frame replaces it.
      }
    };

    return () => socket.close();
  }
}
