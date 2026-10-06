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
 * investing.com economic calendar — the site the user actually reads
 * (th.investing.com/economic-calendar), so the impact stars and the event names
 * match what they are used to seeing.
 *
 * There is no public API, so this reads the site's own server-rendered data.
 * Two code paths, both verified against the live site:
 *
 *  1. TODAY  — the page embeds a `__NEXT_DATA__` JSON blob whose
 *     `economicCalendarStore.calendarEventsByDate` holds clean, typed rows with
 *     exact UTC timestamps. Preferred, because there is no HTML to misparse.
 *
 *  2. A DATE RANGE — the legacy `getCalendarFilteredData` endpoint still serves
 *     an HTML table for an arbitrary `dateFrom`/`dateTo`. Required for anything
 *     beyond today, because the React page only ever server-renders the current
 *     day regardless of query parameters.
 *
 *  3. HISTORY — an event's own page embeds up to 100 past releases as JSON,
 *     including each one's UTC timestamp and whether it beat or missed. That is
 *     what feeds the reaction study.
 *
 * `timeZone=55` is investing.com's id for UTC. This was not assumed: it was
 * calibrated by requesting a known release through both paths and confirming
 * the legacy endpoint returned the same wall-clock time as the JSON's ISO `Z`
 * timestamp. Anything else here would silently shift every event by hours.
 *
 * Scraping is fragile by nature, which is why this provider never throws into
 * the UI — NewsService falls back and the screen says where the data came from.
 */

const UTC_TIMEZONE_ID = 55;

/** Looks like a browser because the edge in front of the site requires it. */
const BROWSER_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "accept-language": "en-US,en;q=0.9,th;q=0.8",
};

export type InvestingEdition = "th" | "en";

function baseUrl(edition: InvestingEdition): string {
  // The Thai edition returns Thai event names for free, which is exactly what
  // a Thai-first app wants. The English edition is the same data in English.
  return edition === "th" ? "https://th.investing.com" : "https://www.investing.com";
}

function toImpact(raw: unknown): NewsImpact {
  const value = Number(raw);
  if (value >= 3) return 3;
  if (value === 2) return 2;
  return 1;
}

function impactFromWord(raw: unknown): NewsImpact {
  const word = String(raw ?? "").toLowerCase();
  if (word === "high") return 3;
  if (word === "moderate" || word === "medium") return 2;
  return 1;
}

/**
 * investing.com colours the actual value green when the print was good for the
 * currency and red when it was bad, and that colouring is polarity-aware: a
 * higher jobless-claims number is red even though the number rose. We take
 * their verdict rather than comparing numbers ourselves, because only they know
 * which direction is "good" for each of several thousand series.
 */
function surpriseFromColor(color: unknown): NewsSurprise | null {
  const value = String(color ?? "").toLowerCase();
  if (value.includes("green")) return "better";
  if (value.includes("red")) return "worse";
  if (value.includes("black")) return "inline";
  return null;
}

function surpriseFromWord(word: unknown): NewsSurprise {
  const value = String(word ?? "").toLowerCase();
  if (value === "positive") return "better";
  if (value === "negative") return "worse";
  return "inline";
}

function nullable(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length === 0 ? null : text;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Pulls the `__NEXT_DATA__` payload out of a server-rendered page. */
function extractNextData(html: string): Record<string, unknown> {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!match || !match[1]) throw new NewsProviderError("investing", "__NEXT_DATA__ not found");
  try {
    return JSON.parse(match[1]) as Record<string, unknown>;
  } catch {
    throw new NewsProviderError("investing", "__NEXT_DATA__ was not valid JSON");
  }
}

function pageState(html: string): Record<string, unknown> {
  const data = extractNextData(html);
  const props = (data["props"] ?? {}) as Record<string, unknown>;
  const pageProps = (props["pageProps"] ?? {}) as Record<string, unknown>;
  return (pageProps["state"] ?? {}) as Record<string, unknown>;
}

interface RawCalendarRow {
  eventId?: number;
  occurrenceId?: number;
  type?: string;
  time?: string;
  currency?: string;
  country?: string;
  importance?: string;
  event?: string;
  eventLong?: string;
  suffix?: string;
  period?: string;
  actual?: string;
  forecast?: string;
  previous?: string;
  actualColor?: string;
  isSpeech?: boolean;
  path?: string;
  unit?: string;
}

function fromJsonRow(row: RawCalendarRow, source: string): NewsEvent | null {
  const time = Math.floor(Date.parse(String(row.time ?? "")) / 1000);
  if (!Number.isFinite(time) || time === 0) return null;

  const eventId = Number(row.eventId ?? 0);
  const occurrenceId = Number.isFinite(Number(row.occurrenceId)) ? Number(row.occurrenceId) : null;
  const title = [row.event, row.suffix].filter(Boolean).join(" ").trim();

  return {
    id: `${eventId}:${occurrenceId ?? time}`,
    eventId,
    occurrenceId,
    time,
    currency: String(row.currency ?? "").toUpperCase(),
    country: String(row.country ?? ""),
    impact: toImpact(row.importance),
    title: title.length > 0 ? title : String(row.eventLong ?? ""),
    period: String(row.period ?? "").trim(),
    actual: nullable(row.actual),
    forecast: nullable(row.forecast),
    previous: nullable(row.previous),
    surprise: row.actual ? surpriseFromColor(row.actualColor) : null,
    isSpeech: Boolean(row.isSpeech),
    isHoliday: row.type === "holiday",
    path: nullable(row.path),
    source,
  };
}

/* -------------------------------------------------------------------------- */
/*  Legacy HTML table parsing (needed for any range beyond today)             */
/* -------------------------------------------------------------------------- */

const ROW_RE = /<tr id="eventRowId_(\d+)"([\s\S]*?)<\/tr>/g;
const ATTR_EVENT_ID = /event_attr_ID="(\d+)"/;
const ATTR_DATETIME = /data-event-datetime="([^"]+)"/;
const CELL_SENTIMENT = /class="[^"]*sentiment[^"]*"[^>]*data-img_key="(?:bull|bear)(\d)"/;
const CELL_COUNTRY = /class="ceFlags[^"]*"[^>]*data-img_key="([^"]*)"/;
const CELL_CURRENCY = /class="[^"]*flagCur[^"]*"[^>]*>[\s\S]*?<\/span>\s*([A-Z]{3})/;
const CELL_EVENT = /<td[^>]*class="left event"[^>]*>([\s\S]*?)<\/td>/;
const CELL_EVENT_HREF = /href="([^"]+)"/;
const CELL_ACTUAL = /id="eventActual_\d+"[^>]*>([\s\S]*?)<\/td>/;
const CELL_ACTUAL_CLASS = /<td[^>]*class="([^"]*)"[^>]*id="eventActual_\d+"/;
const CELL_FORECAST = /id="eventForecast_\d+"[^>]*>([\s\S]*?)<\/td>/;
const CELL_PREVIOUS = /id="eventPrevious_\d+"[^>]*>([\s\S]*?)<\/td>/;
const IS_SPEECH = /class="[^"]*audioLink/;

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * `2026/10/06 11:30:00` in the timezone we requested — UTC, because every
 * request pins `timeZone=55`. Parsed by hand rather than with Date.parse so the
 * server's own locale can never shift it.
 */
function parseUtcDateTime(text: string): number {
  const match = text.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return 0;
  const [, y, mo, d, h, mi, s] = match;
  return Math.floor(
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) / 1000,
  );
}

function fromHtmlRow(occurrenceId: number, body: string, source: string): NewsEvent | null {
  const datetime = body.match(ATTR_DATETIME)?.[1];
  if (!datetime) return null;
  const time = parseUtcDateTime(datetime);
  if (time === 0) return null;

  const eventCell = body.match(CELL_EVENT)?.[1] ?? "";
  const title = stripTags(eventCell);
  if (title.length === 0) return null;

  const actualClass = body.match(CELL_ACTUAL_CLASS)?.[1] ?? "";
  const actual = nullable(stripTags(body.match(CELL_ACTUAL)?.[1] ?? ""));

  // A holiday row carries no currency and no numbers, only a country.
  const currency = body.match(CELL_CURRENCY)?.[1] ?? "";
  const eventId = Number(body.match(ATTR_EVENT_ID)?.[1] ?? 0);

  return {
    id: `${eventId}:${occurrenceId}`,
    eventId,
    occurrenceId,
    time,
    currency: currency.toUpperCase(),
    country: (body.match(CELL_COUNTRY)?.[1] ?? "").replace(/_/g, " "),
    impact: toImpact(body.match(CELL_SENTIMENT)?.[1] ?? 1),
    title,
    period: "",
    actual,
    forecast: nullable(stripTags(body.match(CELL_FORECAST)?.[1] ?? "")),
    previous: nullable(stripTags(body.match(CELL_PREVIOUS)?.[1] ?? "")),
    surprise: actual ? surpriseFromColor(actualClass) : null,
    isSpeech: IS_SPEECH.test(body),
    isHoliday: currency.length === 0 && actual === null,
    path: body.match(CELL_EVENT_HREF)?.[1] ?? null,
    source,
  };
}

function isoDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */

export interface InvestingOptions {
  edition?: InvestingEdition;
  /** Injected in tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Abort a slow scrape rather than hanging a page render. */
  timeoutMs?: number;
}

export class InvestingCalendarProvider implements NewsProvider {
  readonly name = "investing.com";
  readonly demo = false;
  private readonly edition: InvestingEdition;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: InvestingOptions = {}) {
    this.edition = options.edition ?? "th";
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.timeoutMs = options.timeoutMs ?? 12_000;
  }

  private async request(url: string, init?: RequestInit): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        ...init,
        headers: { ...BROWSER_HEADERS, ...(init?.headers as Record<string, string> | undefined) },
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) {
        throw new NewsProviderError(this.name, `${url} returned ${response.status}`, response.status);
      }
      return await response.text();
    } catch (error) {
      if (error instanceof NewsProviderError) throw error;
      const reason = error instanceof Error ? error.message : "unknown error";
      throw new NewsProviderError(this.name, `request failed: ${reason}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Today's rows from the page's own JSON — the cleanest of the three paths. */
  async fetchToday(): Promise<NewsEvent[]> {
    const html = await this.request(`${baseUrl(this.edition)}/economic-calendar`);
    const state = pageState(html);
    const store = (state["economicCalendarStore"] ?? {}) as Record<string, unknown>;
    const byDate = (store["calendarEventsByDate"] ?? {}) as Record<string, RawCalendarRow[]>;

    const events: NewsEvent[] = [];
    for (const rows of Object.values(byDate)) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const event = fromJsonRow(row, this.name);
        if (event) events.push(event);
      }
    }
    return events.sort((a, b) => a.time - b.time);
  }

  async fetchCalendar(range: CalendarRange): Promise<CalendarResponse> {
    const fetchedAt = Math.floor(Date.now() / 1000);
    const dateFrom = isoDate(range.from);
    const dateTo = isoDate(range.to);

    const body = new URLSearchParams({
      dateFrom,
      dateTo,
      timeZone: String(UTC_TIMEZONE_ID),
      timeFilter: "timeOnly",
      currentTab: "custom",
      limit_from: "0",
    });

    const text = await this.request(
      `${baseUrl(this.edition)}/economic-calendar/Service/getCalendarFilteredData`,
      {
        method: "POST",
        headers: {
          "x-requested-with": "XMLHttpRequest",
          "content-type": "application/x-www-form-urlencoded",
          referer: `${baseUrl(this.edition)}/economic-calendar/`,
        },
        body: body.toString(),
      },
    );

    let payload: { data?: string };
    try {
      payload = JSON.parse(text) as { data?: string };
    } catch {
      throw new NewsProviderError(this.name, "calendar service did not return JSON");
    }
    const html = payload.data;
    if (typeof html !== "string" || html.length === 0) {
      throw new NewsProviderError(this.name, "calendar service returned no rows");
    }

    const events: NewsEvent[] = [];
    ROW_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ROW_RE.exec(html)) !== null) {
      const occurrenceId = Number(match[1]);
      const event = fromHtmlRow(occurrenceId, match[2] ?? "", this.name);
      if (!event) continue;
      // The service rounds to whole days, so trim back to the asked-for window.
      if (event.time < range.from || event.time > range.to) continue;
      events.push(event);
    }

    if (events.length === 0) {
      throw new NewsProviderError(this.name, "no calendar rows parsed");
    }

    events.sort((a, b) => a.time - b.time);
    return { events, provider: this.name, demo: false, fetchedAt };
  }

  /**
   * Up to 100 past releases of one event, straight from its own page's JSON.
   * `path` is the link the calendar row already gave us; falling back to an id
   * alone does not work because the site's URLs are slug-based.
   */
  async fetchHistory(eventId: number, path?: string): Promise<NewsEventHistory | null> {
    if (!path) return null;
    const url = `${baseUrl(this.edition)}${path.startsWith("/") ? path : `/${path}`}`;
    const html = await this.request(url);
    const state = pageState(html);
    const store = (state["economicCalendarEventStore"] ?? {}) as Record<string, unknown>;
    const event = (store["event"] ?? {}) as Record<string, unknown>;
    const raw = store["occurrences"];
    if (!Array.isArray(raw)) return null;

    const occurrences: NewsOccurrence[] = [];
    for (const item of raw as Record<string, unknown>[]) {
      const time = Math.floor(Date.parse(String(item["occurrence_time"] ?? "")) / 1000);
      if (!Number.isFinite(time) || time === 0) continue;
      occurrences.push({
        eventId,
        occurrenceId: Number(item["occurrence_id"] ?? 0),
        time,
        actual: numberOrNull(item["actualRaw"] ?? item["actual"]),
        forecast: numberOrNull(item["forecastRaw"] ?? item["forecast"]),
        previous: numberOrNull(item["previousRaw"] ?? item["previous"]),
        surprise: surpriseFromWord(item["actual_to_forecast"]),
      });
    }

    if (occurrences.length === 0) return null;
    occurrences.sort((a, b) => b.time - a.time);

    return {
      eventId,
      title: String(event["short_name"] ?? event["event_translated"] ?? ""),
      currency: String(event["currency"] ?? "").toUpperCase(),
      impact: impactFromWord(event["importance"]),
      // The source ships HTML entities and <BR/> inside the description.
      description: stripTags(String(event["description"] ?? "").replace(/&lt;BR\/?&gt;/gi, " ")),
      source: String(event["source"] ?? this.name),
      occurrences,
    };
  }
}
