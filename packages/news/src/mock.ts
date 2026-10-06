import type {
  CalendarRange,
  CalendarResponse,
  NewsEvent,
  NewsEventHistory,
  NewsImpact,
  NewsOccurrence,
  NewsProvider,
} from "./types";

/**
 * A deterministic stand-in calendar.
 *
 * It exists so the news screens are testable and so the app still functions
 * when investing.com is unreachable — not to pretend there is data. Every row
 * it produces is flagged `demo: true` all the way to the UI, which labels it as
 * synthetic exactly like the DEMO price feed does. Nothing here is ever
 * presented as a real release.
 */

interface Template {
  eventId: number;
  currency: string;
  country: string;
  impact: NewsImpact;
  title: string;
  /** UTC hour the series normally prints at. */
  hour: number;
  minute: number;
  /** Day of week it prints on, 0 = Sunday. */
  weekday: number;
}

const TEMPLATES: Template[] = [
  { eventId: 900_227, currency: "USD", country: "United States", impact: 3, title: "Non-Farm Payrolls (DEMO)", hour: 12, minute: 30, weekday: 5 },
  { eventId: 900_733, currency: "USD", country: "United States", impact: 3, title: "CPI y/y (DEMO)", hour: 12, minute: 30, weekday: 3 },
  { eventId: 900_168, currency: "USD", country: "United States", impact: 3, title: "Fed Interest Rate Decision (DEMO)", hour: 18, minute: 0, weekday: 3 },
  { eventId: 900_294, currency: "USD", country: "United States", impact: 2, title: "Initial Jobless Claims (DEMO)", hour: 12, minute: 30, weekday: 4 },
  { eventId: 900_164, currency: "EUR", country: "Euro Zone", impact: 3, title: "ECB Interest Rate Decision (DEMO)", hour: 12, minute: 15, weekday: 4 },
  { eventId: 900_068, currency: "EUR", country: "Euro Zone", impact: 2, title: "Euro Zone CPI Flash (DEMO)", hour: 9, minute: 0, weekday: 2 },
  { eventId: 900_170, currency: "GBP", country: "United Kingdom", impact: 3, title: "BoE Interest Rate Decision (DEMO)", hour: 11, minute: 0, weekday: 4 },
  { eventId: 900_171, currency: "JPY", country: "Japan", impact: 2, title: "BoJ Policy Statement (DEMO)", hour: 3, minute: 0, weekday: 5 },
];

/** Stable pseudo-randomness: the same week always yields the same calendar. */
function hash(seed: number): number {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 0xffffffff;
}

function dayStart(unixSeconds: number): number {
  return Math.floor(unixSeconds / 86_400) * 86_400;
}

export class MockNewsProvider implements NewsProvider {
  readonly name = "demo-calendar";
  readonly demo = true;

  async fetchCalendar(range: CalendarRange): Promise<CalendarResponse> {
    const events: NewsEvent[] = [];
    const firstDay = dayStart(range.from);
    const lastDay = dayStart(range.to);

    for (let day = firstDay; day <= lastDay; day += 86_400) {
      const weekday = new Date(day * 1000).getUTCDay();
      for (const template of TEMPLATES) {
        if (template.weekday !== weekday) continue;
        const time = day + template.hour * 3600 + template.minute * 60;
        if (time < range.from || time > range.to) continue;

        const released = time < Math.floor(Date.now() / 1000);
        const roll = hash(template.eventId + day);
        const occurrenceId = template.eventId * 1000 + Math.floor(day / 86_400);

        events.push({
          id: `${template.eventId}:${occurrenceId}`,
          eventId: template.eventId,
          occurrenceId,
          time,
          currency: template.currency,
          country: template.country,
          impact: template.impact,
          title: template.title,
          period: "",
          actual: released ? (roll * 200).toFixed(1) : null,
          forecast: (roll * 190).toFixed(1),
          previous: (roll * 180).toFixed(1),
          surprise: released ? (roll > 0.5 ? "better" : "worse") : null,
          isSpeech: false,
          isHoliday: false,
          path: null,
          source: this.name,
        });
      }
    }

    events.sort((a, b) => a.time - b.time);
    return {
      events,
      provider: this.name,
      demo: true,
      fetchedAt: Math.floor(Date.now() / 1000),
      note: "Synthetic calendar. The releases and numbers are not real — use it to see how the screen behaves, never to plan a trade.",
    };
  }

  /** 24 monthly releases on the same weekday/hour, alternating better/worse. */
  async fetchHistory(eventId: number): Promise<NewsEventHistory | null> {
    const template = TEMPLATES.find((t) => t.eventId === eventId);
    if (!template) return null;

    const occurrences: NewsOccurrence[] = [];
    const now = Math.floor(Date.now() / 1000);
    for (let i = 1; i <= 24; i += 1) {
      const time = dayStart(now - i * 28 * 86_400) + template.hour * 3600 + template.minute * 60;
      const roll = hash(eventId + i);
      occurrences.push({
        eventId,
        occurrenceId: eventId * 1000 + i,
        time,
        actual: Number((roll * 200).toFixed(1)),
        forecast: Number((roll * 190).toFixed(1)),
        previous: Number((roll * 180).toFixed(1)),
        surprise: roll > 0.5 ? "better" : "worse",
      });
    }

    return {
      eventId,
      title: template.title,
      currency: template.currency,
      impact: template.impact,
      description:
        "Synthetic event used for demonstration. The reaction history below is generated, not measured from a real feed.",
      source: this.name,
      occurrences,
    };
  }
}
