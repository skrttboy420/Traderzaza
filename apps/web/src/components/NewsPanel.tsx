"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { NewsEvent, NewsImpact, NewsRisk, ReactionGroup, ReactionReading, ReactionStudy } from "@atc/news";
import type { DataStatus } from "@atc/types";

import { useLocale, useT } from "@/i18n/provider";
import { formatDuration, formatNumber, formatPercent, formatTime } from "@/lib/format";
import { Badge, Row, SectionTitle, cx } from "./ui";

/**
 * §28 economic calendar, on screen.
 *
 * The user's complaint about the rest of the app applies doubly to news: a
 * screen that says "high impact" and nothing else is decoration. So every row
 * here carries the numbers behind it — the source's impact rating, the
 * forecast, the previous print, and whether the release beat or missed — and
 * every claim about what the market *did* can be opened up into the individual
 * releases it was measured from.
 *
 * What this panel never does: predict the number, or predict the direction. The
 * risk line answers "is something about to distort this market", which is a
 * reason to wait rather than a signal.
 */

interface NewsResponse {
  symbol: string;
  events: NewsEvent[];
  risk: NewsRisk;
  currencies: string[];
  provider: string;
  demo: boolean;
  note?: string;
  fetchedAt: number;
}

interface ReactionResponse {
  available: boolean;
  reason?: string;
  event?: {
    eventId: number;
    title: string;
    currency: string;
    impact: NewsImpact;
    description: string;
    source: string;
  };
  study?: ReactionStudy;
  better?: ReactionReading;
  worse?: ReactionReading;
  releasesKnown?: number;
  dataStatus?: DataStatus | null;
}

const RISK_TONE: Record<NewsRisk["level"], string> = {
  clear: "border-[var(--color-long)]/40 bg-[var(--color-long-soft)] text-[var(--color-long)]",
  caution: "border-[var(--color-wait)]/40 bg-[var(--color-wait-soft)] text-[var(--color-wait)]",
  blackout: "border-[var(--color-short)]/40 bg-[var(--color-short-soft)] text-[var(--color-short)]",
};

const IMPACT_TONE: Record<NewsImpact, string> = {
  1: "text-[var(--color-faint)]",
  2: "text-[var(--color-wait)]",
  3: "text-[var(--color-short)]",
};

/** How often the calendar is re-fetched so the blackout verdict stays current. */
const REFRESH_MS = 60_000;
/** How often the countdowns tick. Cheap, and the copy is only minute-accurate. */
const TICK_MS = 15_000;

/**
 * A ticking wall clock, in unix seconds.
 *
 * It starts as `null` and is only set from an effect, because `Date.now()`
 * during render would differ between the server pass and the client pass. Every
 * caller therefore has to say what to show before the first tick — which is
 * also the honest thing to do, since before the first tick we genuinely do not
 * know the browser's time.
 */
function useClock(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/**
 * Seconds until a release, measured against the browser clock once it is
 * available and against the server's own reading before that.
 *
 * This matters more than it looks: `risk.secondsAway` is frozen at the moment
 * the server answered, so a tab left open for twenty minutes would keep
 * claiming "in 25 minutes" about a release that already printed. A stale
 * blackout countdown is the one number on this panel that could actively
 * mislead someone.
 */
function secondsAway(eventTime: number | undefined, fallback: number | null, now: number | null): number | null {
  if (eventTime === undefined) return fallback;
  if (now === null) return fallback;
  return eventTime - now;
}

/** The source's own 1-3 rating, drawn the way the user already reads it. */
function ImpactStars({ impact, label }: { impact: NewsImpact; label: string }) {
  return (
    <span className={cx("shrink-0 text-[11px] leading-none", IMPACT_TONE[impact])} title={label}>
      <span aria-hidden>{"★".repeat(impact) + "☆".repeat(3 - impact)}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function NewsPanel({ symbol, minImpact = 2 }: { symbol: string; minImpact?: NewsImpact }) {
  const t = useT("news");
  const { locale } = useLocale();
  const [data, setData] = useState<NewsResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const now = useClock();

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setState("loading");
    try {
      const response = await fetch(`/api/news?symbol=${encodeURIComponent(symbol)}&minImpact=${minImpact}`);
      if (!response.ok) throw new Error("calendar failed");
      setData((await response.json()) as NewsResponse);
      setState("ready");
    } catch {
      // News failing must never take the price analysis down with it. A failed
      // background refresh keeps the rows that are already on screen rather
      // than blanking a working panel.
      if (!quiet) setState("error");
    }
  }, [symbol, minImpact]);

  useEffect(() => {
    void load();
  }, [load]);

  // The blackout verdict is computed by the engine, not here, so the only way
  // to keep it true is to ask again. Quietly, so a refresh never flashes the
  // loading state over rows the user is reading.
  useEffect(() => {
    const id = window.setInterval(() => void load(true), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  if (state === "loading") {
    return (
      <section className="card p-4">
        <SectionTitle title={t("title")} />
        <p className="text-[12.5px] text-[var(--color-faint)]">{t("loading")}</p>
      </section>
    );
  }

  if (state === "error" || !data) {
    return (
      <section className="card p-4">
        <SectionTitle title={t("title")} />
        <p className="text-[12.5px] text-[var(--color-muted)]">{t("failed")}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12.5px] text-[var(--color-text)]"
        >
          {t("retry")}
        </button>
      </section>
    );
  }

  const { risk } = data;
  const riskSeconds = secondsAway(risk.event?.time, risk.secondsAway, now);
  const away = riskSeconds === null ? t("now") : formatDuration(Math.abs(riskSeconds), locale);

  return (
    <section className="card p-4">
      <SectionTitle
        title={t("title")}
        subtitle={t("subtitle", { symbol })}
        hint={t("watching", { list: data.currencies.join(", ") })}
        right={
          <Badge className={RISK_TONE[risk.level]} glyph={risk.level === "clear" ? "✓" : "⚠"}>
            {t(`level.${risk.level}`)}
          </Badge>
        }
      />

      {/* The verdict in words, with the event and the time it is away. */}
      <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-[12.5px] leading-relaxed text-[var(--color-text)]/90">
        {t(`risk.${risk.reasonKey}`, { title: risk.event?.title ?? "—", time: away })}
      </p>
      <p className="mt-2 text-[11px] leading-snug text-[var(--color-faint)]">{t("riskHint")}</p>

      {data.demo ? (
        <div className="mt-3 rounded-lg border border-[var(--color-wait)]/40 bg-[var(--color-wait-soft)] p-3">
          <Badge className="border-[var(--color-wait)]/40 text-[var(--color-wait)]" glyph="⚠">
            {t("demoBadge")}
          </Badge>
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--color-wait)]">{t("demoNote")}</p>
        </div>
      ) : null}

      {data.provider === "none" ? (
        <p className="mt-3 text-[12.5px] leading-relaxed text-[var(--color-muted)]">{t("noSource")}</p>
      ) : null}

      <ul className="mt-3 divide-y divide-[var(--color-border)]">
        {data.events.map((event) => (
          <EventRow
            key={event.id}
            event={event}
            symbol={symbol}
            now={now ?? data.fetchedAt}
            open={openEvent === event.id}
            onToggle={() => setOpenEvent(openEvent === event.id ? null : event.id)}
          />
        ))}
      </ul>

      {data.events.length === 0 && data.provider !== "none" ? (
        <p className="mt-3 text-[12.5px] text-[var(--color-faint)]">{t("empty")}</p>
      ) : null}

      <p className="mt-3 border-t border-[var(--color-border)] pt-3 text-[11px] text-[var(--color-faint)]">
        {t("sourceLabel")}: {data.provider} · {t("impactHint")}
      </p>
    </section>
  );
}

/**
 * The one-line version for the dashboard: is a release about to distort this
 * market, and which one. Deliberately high-impact only — a low-impact print
 * does not belong on a screen the user glances at.
 */
export function NewsRiskStrip({ symbol }: { symbol: string }) {
  const t = useT("news");
  const { locale } = useLocale();
  const [data, setData] = useState<NewsResponse | null>(null);
  const now = useClock();

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const response = await fetch(`/api/news?symbol=${encodeURIComponent(symbol)}&minImpact=3`);
        if (!response.ok) return;
        const payload = (await response.json()) as NewsResponse;
        if (!cancelled) setData(payload);
      } catch {
        // Silent here: the dashboard has plenty to say without the calendar,
        // and the full panel on /news reports the failure properly.
      }
    };
    void run();
    // A dashboard is the screen most likely to be left open, which makes it the
    // screen most likely to show a blackout that has already expired — or to
    // miss one that has just opened.
    const id = window.setInterval(() => void run(), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [symbol]);

  // Nothing to warn about yet, or nothing worth interrupting the dashboard for.
  if (!data || data.risk.level === "clear") return null;

  const riskSeconds = secondsAway(data.risk.event?.time, data.risk.secondsAway, now);
  const away = riskSeconds === null ? t("now") : formatDuration(Math.abs(riskSeconds), locale);

  return (
    <Link
      href="/news"
      className={cx(
        "flex items-start gap-2.5 rounded-lg border p-3 transition-colors",
        RISK_TONE[data.risk.level],
      )}
    >
      <span aria-hidden className="mt-0.5 shrink-0 text-[12px]">
        ⚠
      </span>
      <span className="min-w-0">
        <span className="block text-[12px] font-semibold">
          {t(`level.${data.risk.level}`)} · {symbol}
        </span>
        <span className="mt-0.5 block text-[11.5px] leading-snug opacity-90">
          {t(`risk.${data.risk.reasonKey}`, { title: data.risk.event?.title ?? "—", time: away })}
        </span>
      </span>
    </Link>
  );
}

const SURPRISE_TONE: Record<string, string> = {
  better: "border-[var(--color-long)]/40 bg-[var(--color-long-soft)] text-[var(--color-long)]",
  worse: "border-[var(--color-short)]/40 bg-[var(--color-short-soft)] text-[var(--color-short)]",
  inline: "border-[var(--color-border)] text-[var(--color-muted)]",
};

function EventRow({
  event,
  symbol,
  now,
  open,
  onToggle,
}: {
  event: NewsEvent;
  symbol: string;
  /** Unix seconds, ticking. Passed in rather than read here so every row on the
   *  panel agrees on what "now" is, and so render stays pure. */
  now: number;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useT("news");
  const { locale } = useLocale();
  const delta = event.time - now;
  const relative =
    delta >= 0
      ? t("inTime", { time: formatDuration(delta, locale) })
      : t("agoTime", { time: formatDuration(-delta, locale) });

  return (
    <li className="py-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <ImpactStars impact={event.impact} label={t(`impact.${impactKey(event.impact)}`)} />
            <span className="num shrink-0 text-[11.5px] font-semibold text-[var(--color-muted)]">
              {event.currency || "—"}
            </span>
            <span className="num shrink-0 text-[11.5px] text-[var(--color-faint)]">
              {formatTime(event.time, locale)}
            </span>
            <span className="shrink-0 text-[11px] text-[var(--color-faint)]">· {relative}</span>
          </div>
          <p className="mt-1 text-[13px] font-medium leading-snug text-[var(--color-text)]">
            {event.title}
            {event.period ? <span className="text-[var(--color-faint)]"> {event.period}</span> : null}
          </p>
        </div>
        <Badge
          className={SURPRISE_TONE[event.surprise ?? "inline"] ?? "border-[var(--color-border)]"}
          title={t("surpriseHint")}
        >
          {event.surprise ? t(`surprise.${event.surprise}`) : t("surprise.pending")}
        </Badge>
      </div>

      {/* The numbers, so "high impact" is never the whole story. */}
      <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg bg-[var(--color-surface-2)] px-3 py-2">
        <MiniStat label={t("actual")} value={event.actual ?? t("notOut")} />
        <MiniStat label={t("forecast")} value={event.forecast ?? t("notOut")} />
        <MiniStat label={t("previous")} value={event.previous ?? t("notOut")} />
      </div>

      {event.isHoliday ? (
        <p className="mt-2 text-[11.5px] text-[var(--color-faint)]">{t("holiday")}</p>
      ) : null}

      {/* Holidays and speeches have no forecast series, so there is nothing to
          measure a beat-or-miss reaction against. */}
      {!event.isHoliday && !event.isSpeech ? (
        <>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="mt-2 text-[12px] font-medium text-[var(--color-limit)] underline decoration-dotted underline-offset-4"
          >
            {open ? t("reaction.close") : t("reaction.open")}
          </button>
          {open ? <ReactionBlock symbol={symbol} event={event} /> : null}
        </>
      ) : null}
    </li>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-faint)]">{label}</div>
      <div className="num mt-0.5 truncate text-[12.5px] font-semibold text-[var(--color-text)]">{value}</div>
    </div>
  );
}

function impactKey(impact: NewsImpact): "low" | "medium" | "high" {
  return impact === 3 ? "high" : impact === 2 ? "medium" : "low";
}

/* -------------------------------------------------------------------------- */
/*  "Last time this printed green, gold fell"                                 */
/* -------------------------------------------------------------------------- */

function ReactionBlock({ symbol, event }: { symbol: string; event: NewsEvent }) {
  const t = useT("news");
  const { locale } = useLocale();
  const [data, setData] = useState<ReactionResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setState("loading");
      try {
        const query = new URLSearchParams({ symbol, eventId: String(event.eventId) });
        if (event.path) query.set("path", event.path);
        const response = await fetch(`/api/news/reaction?${query.toString()}`);
        if (!response.ok) throw new Error("reaction failed");
        const payload = (await response.json()) as ReactionResponse;
        if (!cancelled) {
          setData(payload);
          setState("ready");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [symbol, event.eventId, event.path]);

  if (state === "loading") {
    return <p className="mt-2 text-[12px] text-[var(--color-faint)]">{t("reaction.loading")}</p>;
  }
  if (state === "error" || !data) {
    return <p className="mt-2 text-[12px] text-[var(--color-muted)]">{t("failed")}</p>;
  }
  if (!data.available || !data.study) {
    return <p className="mt-2 text-[12px] text-[var(--color-muted)]">{t("reaction.unavailable")}</p>;
  }

  const study = data.study;
  const minutes = study.windowMinutes;
  const measured = study.samples.length;

  return (
    <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
      <SectionTitle title={t("reaction.title")} hint={t("reaction.window", { minutes })} />

      {/* Not enough is a result, and it is stated instead of averaged over. */}
      {!study.usable ? (
        <p className="text-[12.5px] leading-relaxed text-[var(--color-wait)]">
          {t("reaction.notEnough", { count: measured })}
        </p>
      ) : null}

      <div className="space-y-2">
        {data.better ? (
          <GroupCard
            title={t("reaction.betterGroup")}
            group={study.better}
            reading={data.better}
            symbol={symbol}
          />
        ) : null}
        {data.worse ? (
          <GroupCard
            title={t("reaction.worseGroup")}
            group={study.worse}
            reading={data.worse}
            symbol={symbol}
          />
        ) : null}
      </div>

      {study.skipped > 0 ? (
        <p className="mt-2 text-[11px] leading-snug text-[var(--color-faint)]">
          {t("reaction.skipped", { count: study.skipped })}
        </p>
      ) : null}

      {/* FACT / INTERPRETATION / ASSUMPTION kept visually separate (§35). */}
      {study.usable ? (
        <div className="mt-3 space-y-2">
          <Lead
            tone="border-l-[var(--color-limit)] text-[var(--color-limit)]"
            label={t("reaction.factLead")}
            body={t("reaction.fact", {
              count: measured,
              minutes,
              median: formatPercent(dominantMedian(study), 2),
            })}
          />
          <Lead
            tone="border-l-[var(--color-wait)] text-[var(--color-wait)]"
            label={t("reaction.interpretationLead")}
            body={t("reaction.interpretation", { symbol })}
          />
          <Lead
            tone="border-l-[var(--color-neutral)] text-[var(--color-muted)]"
            label={t("reaction.assumptionLead")}
            body={t("reaction.assumption")}
          />
        </div>
      ) : null}

      {/* Every number above can be traced back to these rows. */}
      {study.samples.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-[12px] font-medium text-[var(--color-muted)]">
            {t("reaction.listTitle")}
          </summary>
          <ul className="mt-2 space-y-1">
            {study.samples.map((sample) => (
              <li key={sample.occurrenceId} className="flex items-baseline justify-between gap-2 text-[11.5px]">
                <span className="num shrink-0 text-[var(--color-faint)]">
                  {formatTime(sample.time, locale)}
                </span>
                <span className="min-w-0 flex-1 truncate text-center text-[var(--color-muted)]">
                  {t(`surprise.${sample.surprise}`)}
                </span>
                <span className="num shrink-0 text-[var(--color-faint)]">{formatNumber(sample.basePrice, 2)}</span>
                <span
                  className={cx(
                    "num shrink-0 font-semibold",
                    sample.movePercent >= 0 ? "text-[var(--color-long)]" : "text-[var(--color-short)]",
                  )}
                >
                  {sample.movePercent >= 0 ? "+" : ""}
                  {formatPercent(sample.movePercent, 2)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <p className="mt-3 border-t border-[var(--color-border)] pt-2 text-[11px] leading-relaxed text-[var(--color-faint)]">
        {t("reaction.disclaimer")}
        {data.dataStatus ? ` · ${data.dataStatus.quality} · ${data.dataStatus.provider}` : ""}
      </p>
    </div>
  );
}

/** The group with more samples describes the event best; ties go to "better". */
function dominantMedian(study: ReactionStudy): number {
  return study.better.count >= study.worse.count
    ? study.better.medianMovePercent
    : study.worse.medianMovePercent;
}

function GroupCard({
  title,
  group,
  reading,
  symbol,
}: {
  title: string;
  group: ReactionGroup;
  reading: ReactionReading;
  symbol: string;
}) {
  const t = useT("news");
  const total = group.upCount + group.downCount;
  const same = Math.max(group.upCount, group.downCount);

  const sentence =
    reading.tendency === "up"
      ? t("reaction.tendencyUp", { symbol, same, total })
      : reading.tendency === "down"
        ? t("reaction.tendencyDown", { symbol, same, total })
        : reading.tendency === "mixed"
          ? t("reaction.tendencyMixed", { up: group.upCount, down: group.downCount })
          : t("reaction.tendencyUnknown");

  const tone =
    reading.tendency === "up"
      ? "text-[var(--color-long)]"
      : reading.tendency === "down"
        ? "text-[var(--color-short)]"
        : "text-[var(--color-muted)]";

  return (
    <div className="rounded-lg border border-[var(--color-border)] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-[12.5px] font-semibold text-[var(--color-text)]">{title}</h4>
        <span className="num shrink-0 text-[11px] text-[var(--color-faint)]">
          {t("reaction.samples", { count: group.count })}
        </span>
      </div>
      <p className={cx("mt-1 text-[12.5px] leading-relaxed", tone)}>{sentence}</p>
      {group.count > 0 ? (
        <div className="mt-1">
          <Row label={t("reaction.median")} value={formatPercent(group.medianMovePercent, 2)} />
          <Row label={t("reaction.swing")} value={formatPercent(group.medianRangePercent, 2)} />
        </div>
      ) : null}
    </div>
  );
}

function Lead({ tone, label, body }: { tone: string; label: string; body: string }) {
  return (
    <div className={cx("border-l-2 pl-3", tone)}>
      <div className="text-[10px] font-semibold uppercase tracking-wide">{label}</div>
      <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--color-text)]/90">{body}</p>
    </div>
  );
}
