import type {
  CalendarRange,
  CalendarResponse,
  NewsEvent,
  NewsEventHistory,
  NewsImpact,
  NewsOccurrence,
  NewsProvider,
  NewsSurprise,
} from "./types";
import { NewsProviderError } from "./types";

/**
 * TradingView's economic-calendar service — the primary calendar source.
 *
 * Why this one is primary, written down so the next person does not have to
 * repeat the afternoon of measuring that produced this file:
 *
 *  - investing.com (the site the user named) sits behind an edge that rejects
 *    Node's TLS fingerprint. curl gets 200, `fetch` gets 403, with every header
 *    combination and with custom cipher suites. Vercel runs the same Node, so
 *    that path cannot be the one the product depends on. It is still shipped as
 *    an optional provider for anyone running behind a proxy that can reach it.
 *  - ForexFactory's free JSON feed is reachable from Node but carries only the
 *    coming week, and no `actual` value at all — so no beat/miss, and no release
 *    history. It is kept as a second-line fallback for the schedule.
 *  - This endpoint is reachable from Node (it only wants a browser `origin` and
 *    `referer`), serves an arbitrary date range including years of history, and
 *    returns `actual` / `forecast` / `previous` as *numbers*. That last part is
 *    what makes "what did gold do the last time this printed hot" arithmetic
 *    instead of opinion.
 *
 * Two measured quirks encoded below:
 *
 *  - `importance` is -1 / 0 / 1, not 1-3. It maps onto the three impact levels
 *    traders recognise from investing.com's stars.
 *  - the `indicator` query parameter is silently ignored; only `countries` and
 *    `minImportance` actually filter. History is therefore fetched as
 *    "every high-impact release for this country over the window" and filtered
 *    on `indicator` here. `minImportance` matters: without it the response is
 *    capped at 2000 rows and a two-year window overflows.
 */

const ENDPOINT = "https://economic-calendar.tradingview.com/events";

/**
 * The service answers 403 from nginx without these. It is not a bot wall — the
 * same request with a browser origin succeeds — so this is the documented way
 * the public widget talks to its own backend.
 */
const HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  accept: "application/json",
  origin: "https://www.tradingview.com",
  referer: "https://www.tradingview.com/",
};

/** Countries whose releases can move the six markets this app covers. */
export const DEFAULT_COUNTRIES = ["US", "EU", "GB", "JP", "CH", "AU", "NZ", "CA", "CN", "DE"];

export interface TradingViewOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  countries?: string[];
  /** How far back `fetchHistory` looks. 24 months is ~24 monthly releases. */
  historyMonths?: number;
}

interface TvRow {
  id?: string;
  title?: string;
  country?: string;
  indicator?: string;
  ticker?: string;
  comment?: string;
  category?: string;
  period?: string;
  source?: string;
  actual?: number | null;
  previous?: number | null;
  forecast?: number | null;
  actualRaw?: number | null;
  previousRaw?: number | null;
  forecastRaw?: number | null;
  currency?: string;
  unit?: string;
  scale?: string;
  importance?: number;
  date?: string;
}

/**
 * Series where a bigger number is bad news for the currency. The surprise field
 * promises "better or worse *for that currency*", so comparing raw numbers is
 * not enough: 228k jobless claims against a 242k forecast is a beat, even
 * though the number is lower. investing.com encodes this as a colour; here we
 * have to know it ourselves, so the list is deliberately short and limited to
 * series where the polarity is not arguable.
 */
const INVERTED_INDICATORS = [
  "jobless claims",
  "continuing claims",
  "unemployment rate",
  "unemployment change",
  "unemployed persons",
  "unemployment persons",
  "jobless rate",
  "budget deficit",
  "trade deficit",
  "bankruptcies",
  "foreclosures",
];

function isInverted(indicator: string): boolean {
  const lower = indicator.toLowerCase();
  return INVERTED_INDICATORS.some((needle) => lower.includes(needle));
}

/** -1 low, 0 medium, 1 high — verified against the live response. */
function toImpact(importance: unknown): NewsImpact {
  const value = Number(importance);
  if (value >= 1) return 3;
  if (value === 0) return 2;
  return 1;
}

function minImportanceFor(impact: NewsImpact): number {
  return impact === 3 ? 1 : impact === 2 ? 0 : -1;
}

/**
 * FNV-1a, offset well clear of investing.com's own ids (six digits) and the
 * demo provider's 900_xxx block, so an id can never mean two different series.
 */
function seriesId(country: string, indicator: string): number {
  let hash = 0x811c9dc5;
  const key = `${country}|${indicator}`;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return 100_000_000 + (hash % 900_000_000);
}

/** `7.079` + scale `M` + unit `%` → the string a trader would read. */
function formatValue(value: number | null | undefined, scale?: string, unit?: string): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const suffix = scale ? scale : "";
  const percent = unit === "%" ? "%" : "";
  return `${value}${suffix}${percent}`;
}

/**
 * Beat / miss / in line, computed from the numbers and then flipped for the
 * inverted series above. Null when there is nothing to compare against — an
 * unforecast release has no surprise, and guessing one would be a fabrication.
 */
function toSurprise(row: TvRow): NewsSurprise | null {
  const actual = row.actualRaw ?? row.actual;
  const forecast = row.forecastRaw ?? row.forecast;
  if (actual === null || actual === undefined || !Number.isFinite(actual)) return null;
  if (forecast === null || forecast === undefined || !Number.isFinite(forecast)) return null;
  if (actual === forecast) return "inline";
  const higher = actual > forecast;
  const good = isInverted(row.indicator ?? row.title ?? "") ? !higher : higher;
  return good ? "better" : "worse";
}

function isHoliday(row: TvRow): boolean {
  const indicator = (row.indicator ?? "").toLowerCase();
  return indicator === "holidays" || indicator === "holiday";
}

function isSpeech(row: TvRow): boolean {
  const title = (row.title ?? "").toLowerCase();
  return /speech|speaks|press conference|testimony|statement|minutes/.test(title);
}

function parseIso(value: unknown): number | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function isoFromUnix(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

export class TradingViewCalendarProvider implements NewsProvider {
  readonly name = "tradingview";
  readonly demo = false;

  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly countries: string[];
  private readonly historyMonths: number;
  /**
   * eventId → the country/indicator pair it was hashed from. A hash cannot be
   * reversed, so this is how `fetchHistory(eventId)` works after a calendar
   * fetch without the caller having to carry the path around.
   */
  private readonly seriesIndex = new Map<number, { country: string; indicator: string; impact: NewsImpact }>();

  constructor(options: TradingViewOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 12_000;
    this.countries = options.countries ?? DEFAULT_COUNTRIES;
    this.historyMonths = options.historyMonths ?? 24;
  }

  private async request(params: Record<string, string>): Promise<TvRow[]> {
    const url = new URL(ENDPOINT);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url.toString(), {
        headers: HEADERS,
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) {
        throw new NewsProviderError(this.name, `${url.pathname} returned ${response.status}`, response.status);
      }
      const payload = (await response.json()) as { status?: string; result?: TvRow[] };
      if (payload.status !== "ok" || !Array.isArray(payload.result)) {
        throw new NewsProviderError(this.name, "unexpected response shape");
      }
      return payload.result;
    } catch (error) {
      if (error instanceof NewsProviderError) throw error;
      const reason = error instanceof Error ? error.message : "request failed";
      throw new NewsProviderError(this.name, reason);
    } finally {
      clearTimeout(timer);
    }
  }

  private toEvent(row: TvRow): NewsEvent | null {
    const time = parseIso(row.date);
    if (time === null) return null;
    const indicator = row.indicator ?? row.title ?? "";
    const country = row.country ?? "";
    const impact = toImpact(row.importance);
    const eventId = seriesId(country, indicator);
    this.seriesIndex.set(eventId, { country, indicator, impact });
    const occurrenceId = Number(row.id);

    return {
      id: `${eventId}:${Number.isFinite(occurrenceId) ? occurrenceId : time}`,
      eventId,
      occurrenceId: Number.isFinite(occurrenceId) ? occurrenceId : null,
      time,
      currency: row.currency ?? "",
      country,
      impact,
      title: row.title ?? indicator,
      period: row.period ?? "",
      actual: formatValue(row.actual, row.scale, row.unit),
      forecast: formatValue(row.forecast, row.scale, row.unit),
      previous: formatValue(row.previous, row.scale, row.unit),
      surprise: toSurprise(row),
      isSpeech: isSpeech(row),
      isHoliday: isHoliday(row),
      // Enough for fetchHistory to resolve the series on a cold provider.
      path: `${country}|${indicator}`,
      source: this.name,
    };
  }

  async fetchCalendar(range: CalendarRange): Promise<CalendarResponse> {
    const rows = await this.request({
      from: isoFromUnix(range.from),
      to: isoFromUnix(range.to),
      countries: this.countries.join(","),
    });

    const events: NewsEvent[] = [];
    for (const row of rows) {
      const event = this.toEvent(row);
      if (!event) continue;
      if (event.time < range.from || event.time > range.to) continue;
      events.push(event);
    }
    events.sort((a, b) => a.time - b.time);

    return {
      events,
      provider: this.name,
      demo: false,
      fetchedAt: Math.floor(Date.now() / 1000),
    };
  }

  async fetchHistory(eventId: number, path?: string): Promise<NewsEventHistory | null> {
    const known = this.seriesIndex.get(eventId);
    const parts = path?.split("|") ?? [];
    const country = known?.country ?? parts[0] ?? "";
    const indicator = known?.indicator ?? parts[1] ?? "";
    if (!country || !indicator) return null;

    const now = Math.floor(Date.now() / 1000);
    const rows = await this.request({
      from: isoFromUnix(now - this.historyMonths * 30 * 86_400),
      to: isoFromUnix(now + 86_400),
      countries: country,
      // Keeps a two-year window under the endpoint's 2000-row cap.
      minImportance: String(minImportanceFor(known?.impact ?? 3)),
    });

    const occurrences: NewsOccurrence[] = [];
    let title = indicator;
    let currency = "";
    let description = "";
    let impact: NewsImpact = known?.impact ?? 3;

    for (const row of rows) {
      if ((row.indicator ?? "") !== indicator) continue;
      const time = parseIso(row.date);
      const occurrenceId = Number(row.id);
      if (time === null || !Number.isFinite(occurrenceId)) continue;
      if (row.title) title = row.title;
      if (row.currency) currency = row.currency;
      if (row.comment) description = row.comment;
      impact = toImpact(row.importance);
      const surprise = toSurprise(row);
      // A release with no comparable forecast cannot be grouped by surprise, so
      // it is left out rather than parked in an "inline" bucket it never earned.
      if (!surprise) continue;
      occurrences.push({
        eventId,
        occurrenceId,
        time,
        actual: row.actualRaw ?? row.actual ?? null,
        forecast: row.forecastRaw ?? row.forecast ?? null,
        previous: row.previousRaw ?? row.previous ?? null,
        surprise,
      });
    }

    if (occurrences.length === 0) return null;
    occurrences.sort((a, b) => b.time - a.time);

    return { eventId, title, currency, impact, description, source: this.name, occurrences };
  }
}
