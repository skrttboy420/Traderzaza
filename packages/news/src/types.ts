/**
 * §28 economic calendar.
 *
 * The platform treats news the same way it treats price: a measured FACT first,
 * an interpretation second, and never a prediction dressed up as a fact. So the
 * calendar layer only ever reports (a) what is scheduled, (b) how strong the
 * source rates its impact, and (c) what this market actually did after previous
 * releases of the same event. It does not forecast the number.
 */

/** investing.com's own 1-3 star impact rating. Not our invention, not a score. */
export type NewsImpact = 1 | 2 | 3;

/**
 * Whether the released number was better or worse than the forecast *for that
 * currency*. This is polarity-aware: a higher-than-expected jobless-claims
 * print is "worse", even though the number went up. We take the source's own
 * colouring rather than comparing the raw numbers ourselves, because only the
 * source knows which direction is good for each series.
 */
export type NewsSurprise = "better" | "worse" | "inline";

export interface NewsEvent {
  /** Stable within a release: `${eventId}:${occurrenceId ?? time}`. */
  id: string;
  /** The recurring series, e.g. 227 = US Non-Farm Payrolls. */
  eventId: number;
  /** This specific release. Null for holidays and some speeches. */
  occurrenceId: number | null;
  /** Release time, unix seconds, UTC. Never a local string. */
  time: number;
  /** ISO-4217 of the country whose data it is. Empty for holidays. */
  currency: string;
  country: string;
  impact: NewsImpact;
  title: string;
  /** Reference period as published, e.g. "(Sep)". */
  period: string;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  /** Null until the number is out. */
  surprise: NewsSurprise | null;
  isSpeech: boolean;
  isHoliday: boolean;
  /** Path on the source site, for the "see the full history" link. */
  path: string | null;
  /** Which source produced this row, carried through to the UI. */
  source: string;
}

/** One past release of a recurring event, used by the reaction study. */
export interface NewsOccurrence {
  eventId: number;
  occurrenceId: number;
  time: number;
  actual: number | null;
  forecast: number | null;
  previous: number | null;
  surprise: NewsSurprise;
}

export interface NewsEventHistory {
  eventId: number;
  title: string;
  currency: string;
  impact: NewsImpact;
  /** Plain-language description of the series, from the source. */
  description: string;
  source: string;
  /** Newest first, as published. */
  occurrences: NewsOccurrence[];
}

export interface CalendarRange {
  /** Unix seconds, inclusive. */
  from: number;
  to: number;
}

export interface CalendarResponse {
  events: NewsEvent[];
  /** The provider that answered, so the UI can label the data honestly. */
  provider: string;
  /** True when these rows are synthetic. Must be surfaced, never hidden. */
  demo: boolean;
  fetchedAt: number;
  note?: string;
}

/**
 * Every calendar source implements this. The app never talks to a scraper
 * directly, so replacing investing.com with a paid feed later is a one-line
 * change in the resolver.
 */
export interface NewsProvider {
  readonly name: string;
  readonly demo: boolean;
  /** Events between two instants. Implementations may clamp long ranges. */
  fetchCalendar(range: CalendarRange): Promise<CalendarResponse>;
  /** Past releases of one recurring event. Null when unavailable. */
  fetchHistory(eventId: number, path?: string): Promise<NewsEventHistory | null>;
}

export class NewsProviderError extends Error {
  readonly provider: string;
  readonly status: number | null;

  constructor(provider: string, message: string, status: number | null = null) {
    super(`[${provider}] ${message}`);
    this.name = "NewsProviderError";
    this.provider = provider;
    this.status = status;
  }
}

export function impactLabelKey(impact: NewsImpact): "low" | "medium" | "high" {
  return impact === 3 ? "high" : impact === 2 ? "medium" : "low";
}
