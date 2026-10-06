import { ForexFactoryProvider } from "./forexfactory";
import { InvestingCalendarProvider, type InvestingEdition } from "./investing";
import { MockNewsProvider } from "./mock";
import { TradingViewCalendarProvider } from "./tradingview";
import type { CalendarRange, CalendarResponse, NewsEventHistory, NewsProvider } from "./types";

export interface NewsConfig {
  /**
   * The primary source: reachable from Node, carries `actual` and years of
   * history. Off only for offline development.
   */
  enableTradingView?: boolean;
  /** Second-line schedule source. Current week only, no `actual`. */
  enableForexFactory?: boolean;
  /**
   * Off by default, and that is a measurement not a preference: investing.com's
   * edge answers 403 to Node's TLS fingerprint, so on Vercel this provider only
   * ever burns a request before the fallback. Turn it on when the app runs
   * somewhere that can actually reach the site.
   */
  enableInvesting?: boolean;
  /** Thai edition gives Thai event names for free. */
  edition?: InvestingEdition;
  /** Seconds to keep a calendar response. The calendar changes by the minute
   *  near a release, but the *schedule* barely changes within an hour. */
  ttlSeconds?: number;
  fetchImpl?: typeof fetch;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * The single door to news data.
 *
 * Two rules it enforces, both of them honesty rules:
 *
 *  - A scrape that fails falls back to the demo calendar and says so in `note`,
 *    with `demo: true`. It never returns real-looking rows it did not get.
 *  - Responses are cached, because the alternative is hammering someone else's
 *    site on every page render. The schedule for the next week does not change
 *    minute to minute, so a short TTL costs the user nothing.
 */
export class NewsService {
  private readonly providers: NewsProvider[];
  private readonly ttl: number;
  private readonly calendarCache = new Map<string, CacheEntry<CalendarResponse>>();
  private readonly historyCache = new Map<string, CacheEntry<NewsEventHistory | null>>();

  constructor(providers: NewsProvider[], ttlSeconds = 900) {
    if (providers.length === 0) throw new Error("NewsService needs at least one provider");
    this.providers = providers;
    this.ttl = ttlSeconds;
  }

  /**
   * Order matters and is deliberate: richest-and-reachable first, then
   * schedule-only, then the optional scraper, then demo. The first provider
   * that answers with rows wins, and whichever one it was is named in the
   * response so the screen can label the data.
   */
  static fromConfig(config: NewsConfig = {}): NewsService {
    const fetchOption = config.fetchImpl ? { fetchImpl: config.fetchImpl } : {};
    const providers: NewsProvider[] = [];
    if (config.enableTradingView !== false) {
      providers.push(new TradingViewCalendarProvider({ ...fetchOption }));
    }
    if (config.enableInvesting === true) {
      providers.push(
        new InvestingCalendarProvider({
          ...(config.edition ? { edition: config.edition } : {}),
          ...fetchOption,
        }),
      );
    }
    if (config.enableForexFactory !== false) {
      providers.push(new ForexFactoryProvider({ ...fetchOption }));
    }
    providers.push(new MockNewsProvider());
    return new NewsService(providers, config.ttlSeconds ?? 900);
  }

  private now(): number {
    return Math.floor(Date.now() / 1000);
  }

  async getCalendar(range: CalendarRange): Promise<CalendarResponse> {
    const key = `${range.from}:${range.to}`;
    const cached = this.calendarCache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value;

    const failures: string[] = [];
    for (const provider of this.providers) {
      try {
        const response = await provider.fetchCalendar(range);
        if (response.events.length === 0 && !provider.demo) {
          failures.push(`${provider.name}: no events`);
          continue;
        }
        const value =
          failures.length > 0
            ? { ...response, note: [response.note, `Fell back after: ${failures.join("; ")}`].filter(Boolean).join(" ") }
            : response;
        this.calendarCache.set(key, { value, expiresAt: this.now() + this.ttl });
        return value;
      } catch (error) {
        failures.push(`${provider.name}: ${error instanceof Error ? error.message : "failed"}`);
      }
    }

    // Every provider threw, including the demo one. Report emptiness rather
    // than inventing rows.
    return {
      events: [],
      provider: "none",
      demo: true,
      fetchedAt: this.now(),
      note: `No calendar source answered. ${failures.join("; ")}`,
    };
  }

  async getHistory(eventId: number, path?: string): Promise<NewsEventHistory | null> {
    const key = `${eventId}:${path ?? ""}`;
    const cached = this.historyCache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value;

    for (const provider of this.providers) {
      try {
        const history = await provider.fetchHistory(eventId, path);
        if (!history) continue;
        // History is a long series of past facts, so it can be cached far
        // longer than the forward schedule.
        this.historyCache.set(key, { value: history, expiresAt: this.now() + this.ttl * 4 });
        return history;
      } catch {
        // Try the next provider.
      }
    }
    return null;
  }
}

/** Convenience range: now minus `pastHours`, through now plus `aheadHours`. */
export function calendarWindow(pastHours = 12, aheadHours = 168, now = Math.floor(Date.now() / 1000)): CalendarRange {
  return { from: now - pastHours * 3600, to: now + aheadHours * 3600 };
}
