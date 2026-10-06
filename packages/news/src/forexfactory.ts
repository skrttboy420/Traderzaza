import type {
  CalendarRange,
  CalendarResponse,
  NewsEvent,
  NewsEventHistory,
  NewsImpact,
  NewsProvider,
} from "./types";
import { NewsProviderError } from "./types";

/**
 * ForexFactory's free weekly JSON feed — the second-line schedule source.
 *
 * What it is good for: it is a plain static JSON file, reachable from Node with
 * no headers and no edge challenge, and its High / Medium / Low rating is the
 * same thing traders read as impact stars. If the primary source is down, the
 * app can still tell the user "there is a high-impact USD release in 20
 * minutes", which is the part that protects a position.
 *
 * What it cannot do, measured rather than assumed:
 *
 *  - only the current week exists. `ff_calendar_lastweek.json`,
 *    `nextweek`, `thismonth` and friends all answer 404.
 *  - there is no `actual` field, even for releases that already happened. So
 *    no beat/miss, and `fetchHistory` returns null rather than pretending.
 *
 * Both limits are why this sits behind TradingView instead of in front of it.
 */

const FEED_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

export interface ForexFactoryOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  url?: string;
}

interface FfRow {
  title?: string;
  country?: string;
  date?: string;
  impact?: string;
  forecast?: string;
  previous?: string;
}

function toImpact(raw: unknown): NewsImpact {
  const word = String(raw ?? "").toLowerCase();
  if (word === "high") return 3;
  if (word === "medium" || word === "moderate") return 2;
  return 1;
}

/** `impact: "Holiday"` is how the feed marks a closed market. */
function isHolidayRow(row: FfRow): boolean {
  return String(row.impact ?? "").toLowerCase() === "holiday" || /bank holiday/i.test(row.title ?? "");
}

function isSpeechRow(row: FfRow): boolean {
  return /speaks|speech|press conference|testimony|member/i.test(row.title ?? "");
}

/** FNV-1a in the same 100m block as the other scraper, keyed currency+title. */
function seriesId(currency: string, title: string): number {
  let hash = 0x811c9dc5;
  const key = `ff|${currency}|${title}`;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return 100_000_000 + (hash % 900_000_000);
}

/** The feed publishes `2026-10-06T02:35:00-04:00`; the offset is authoritative. */
function parseTime(value: unknown): number | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function cleanText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

export class ForexFactoryProvider implements NewsProvider {
  readonly name = "forexfactory";
  readonly demo = false;

  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly url: string;

  constructor(options: ForexFactoryOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 12_000;
    this.url = options.url ?? FEED_URL;
  }

  async fetchCalendar(range: CalendarRange): Promise<CalendarResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let rows: FfRow[];
    try {
      const response = await this.fetchImpl(this.url, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) {
        throw new NewsProviderError(this.name, `feed returned ${response.status}`, response.status);
      }
      const payload = (await response.json()) as unknown;
      if (!Array.isArray(payload)) throw new NewsProviderError(this.name, "feed was not an array");
      rows = payload as FfRow[];
    } catch (error) {
      if (error instanceof NewsProviderError) throw error;
      throw new NewsProviderError(this.name, error instanceof Error ? error.message : "request failed");
    } finally {
      clearTimeout(timer);
    }

    const events: NewsEvent[] = [];
    for (const row of rows) {
      const time = parseTime(row.date);
      if (time === null) continue;
      if (time < range.from || time > range.to) continue;
      const title = cleanText(row.title) ?? "";
      if (!title) continue;
      // `country: "All"` marks a global event (OPEC meetings, G20) with no
      // single currency behind it.
      const currency = (row.country ?? "").toUpperCase();
      const eventId = seriesId(currency, title);
      events.push({
        id: `${eventId}:${time}`,
        eventId,
        occurrenceId: null,
        time,
        currency: currency === "ALL" ? "" : currency,
        country: currency,
        impact: toImpact(row.impact),
        title,
        period: "",
        // The feed simply has no actual value, so it stays null and the UI
        // shows a dash instead of inventing a print.
        actual: null,
        forecast: cleanText(row.forecast),
        previous: cleanText(row.previous),
        surprise: null,
        isSpeech: isSpeechRow(row),
        isHoliday: isHolidayRow(row),
        path: null,
        source: this.name,
      });
    }
    events.sort((a, b) => a.time - b.time);

    const covered = range.to - range.from > 8 * 86_400;
    return {
      events,
      provider: this.name,
      demo: false,
      fetchedAt: Math.floor(Date.now() / 1000),
      ...(covered
        ? { note: "ForexFactory's free feed only carries the current week, so the window was trimmed." }
        : {}),
    };
  }

  /** No `actual` in the feed means no release history worth the name. */
  async fetchHistory(_eventId: number, _path?: string): Promise<NewsEventHistory | null> {
    return null;
  }
}
